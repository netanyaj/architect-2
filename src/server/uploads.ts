import "server-only";

import { z } from "zod";
import { UPLOAD_LIMITS } from "@/lib/uploads";
import type { AdminDb } from "./db";

const fileMeta = z.object({ name: z.string().min(1).max(200), type: z.string(), size: z.number().int().positive() });

export type UploadSlot = { name: string; path: string; token: string };

/** "agenda template (final).pdf" → "agenda-template-final.pdf", safe for a storage path. */
function safeName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "file";
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return ext ? `${base}.${ext}` : base;
}

/**
 * Signed upload slots for a project's files (Vercel caps request bodies at 4.5 MB, so the browser uploads straight
 * to the private "uploads" bucket). Checks role, workspace, type, size and count first.
 */
export async function prepareUploads(admin: AdminDb, workspaceId: string, projectId: string, files: { name: string; type: string; size: number }[]) {
  const parsed = z.array(fileMeta).max(UPLOAD_LIMITS.maxFiles).safeParse(files);
  if (!parsed.success) return { error: `Attach up to ${UPLOAD_LIMITS.maxFiles} files.` } as const;
  for (const f of parsed.data) {
    if (!UPLOAD_LIMITS.types.includes(f.type) && !/\.(csv|xlsx)$/i.test(f.name)) return { error: `${f.name} isn't a PDF, a CSV or Excel file, or an image (PNG, JPG, WebP).` } as const;
    if (f.size > UPLOAD_LIMITS.maxBytes) return { error: `${f.name} is over ${UPLOAD_LIMITS.maxBytes / 1024 / 1024} MB.` } as const;
  }
  const slots: UploadSlot[] = [];
  for (const f of parsed.data) {
    const path = `${workspaceId}/${projectId}/${crypto.randomUUID().slice(0, 8)}-${safeName(f.name)}`;
    const { data, error } = await admin.storage.from("uploads").createSignedUploadUrl(path);
    if (error || !data) return { error: "The files couldn't be prepared. Try again." } as const;
    slots.push({ name: f.name, path, token: data.token });
  }
  return { slots } as const;
}


/**
 * Removes a project's uploaded files from the private bucket (its folder: <workspace>/<project>/). Called after the
 * project's database rows are gone, so nothing ever points at a missing file. Best effort: a failure leaves an
 * unreachable file behind (the bucket is private), never a broken project.
 */
export async function removeProjectFiles(admin: AdminDb, workspaceId: string, projectId: string): Promise<number> {
  const folder = `${workspaceId}/${projectId}`;
  let removed = 0;
  for (;;) {
    const { data, error } = await admin.storage.from("uploads").list(folder, { limit: 100 });
    if (error || !data?.length) break;
    const { error: rmError } = await admin.storage.from("uploads").remove(data.map((o) => `${folder}/${o.name}`));
    if (rmError) {
      console.error("removeProjectFiles: couldn't remove files", rmError.message);
      break;
    }
    removed += data.length;
    if (data.length < 100) break;
  }
  return removed;
}
