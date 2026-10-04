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
    if (!UPLOAD_LIMITS.types.includes(f.type)) return { error: `${f.name} isn't a PDF or an image (PNG, JPG, WebP).` } as const;
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

