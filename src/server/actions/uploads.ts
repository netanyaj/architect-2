"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { canBuild } from "@/lib/permissions";
import { csvLine } from "@/lib/csv";
import { UPLOAD_LIMITS } from "@/lib/uploads";
import { createAdminDb } from "../db";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/** Text from the first 20 pages of a PDF (BLUEPRINT-GENERATION step 1), or null if it has none. */
async function pdfText(bytes: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: false });
    const joined = (text as string[]).slice(0, 20).join("\n\n").replace(/[ \t]+/g, " ").trim();
    return joined ? joined.slice(0, 40_000) : null;
  } catch {
    return null;
  }
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** An Excel workbook's first sheet as CSV text (up to 5,000 rows), or null if it can't be read. */
async function xlsxText(bytes: Uint8Array): Promise<string | null> {
  try {
    const { readSheet } = await import("read-excel-file/node");
    const rows = await readSheet(Buffer.from(bytes));
    const text = rows.slice(0, 5001).map((r) => csvLine(r as unknown[])).join("\n");
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/**
 * Registers uploaded files on the project: reads PDFs' text for the planner and lists each file in Files.
 * Only paths inside this project's folder are accepted, and each is registered once.
 */
export async function finishUploads(input: { projectId: string; uploads: { name: string; path: string }[] }): Promise<ActionResult<{ registered: number; unreadable: string[] }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't add files." };
  if (!z.string().uuid().safeParse(input.projectId).success) return { ok: false, message: "That project isn't in this workspace." };
  const admin = createAdminDb();
  const { data: project } = await admin.from("projects").select("id").eq("id", input.projectId).eq("workspace_id", ctx.workspace.id).maybeSingle();
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  const folder = `${ctx.workspace.id}/${project.id}/`;

  let registered = 0;
  const unreadable: string[] = [];
  for (const u of input.uploads.slice(0, UPLOAD_LIMITS.maxFiles)) {
    if (!u.path.startsWith(folder) || u.path.includes("..")) continue;
    const { data: existing } = await admin.from("files").select("id").eq("storage_path", u.path).maybeSingle();
    if (existing) continue;
    const { data: blob, error } = await admin.storage.from("uploads").download(u.path);
    if (error || !blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const csv = /\.csv$/i.test(u.path);
    const xlsx = /\.xlsx$/i.test(u.path);
    const mime = csv ? "text/csv" : xlsx ? XLSX_MIME : blob.type || (u.path.endsWith(".pdf") ? "application/pdf" : "application/octet-stream");
    const size = bytes.byteLength; // before reading: the PDF reader takes over the buffer it's given
    // A CSV is kept as text (up to 2 MB): the planner reads its start, and the Data tab parses it as the test
    // version's data. An Excel workbook's first sheet is turned into the same CSV text.
    const text = mime === "application/pdf" ? await pdfText(bytes.slice()) : csv ? new TextDecoder().decode(bytes.slice(0, 2_000_000)) || null : xlsx ? await xlsxText(bytes) : null;
    if ((csv || xlsx) && !text) unreadable.push(u.name);
    if (mime === "application/pdf" && !text) unreadable.push(u.name);
    await admin.from("files").insert({
      project_id: project.id,
      kind: "upload",
      path: u.name.slice(0, 200),
      name: u.name.slice(0, 200),
      storage_path: u.path,
      mime,
      size_bytes: size,
      extracted_text: text,
      uploaded_by: ctx.user.id,
    });
    registered++;
  }
  revalidatePath(`/p/${project.id}`);
  return { ok: true, registered, unreadable };
}
