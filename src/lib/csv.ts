/**
 * CSV for uploaded data (M5.5): a real parser (quoted fields, commas and line breaks inside quotes, "" escapes, CRLF,
 * a byte-order mark, ; or tab as the separator when the header uses them), and the Data tab's table from it. Shared;
 * no I/O.
 */
import type { Column, DataTable } from "./app-data";

const MAX_ROWS = 1000;

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const keyOf = (label: string, i: number, used: Set<string>) => {
  let k = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `column_${i + 1}`;
  while (used.has(k)) k = `${k}_${i + 1}`;
  used.add(k);
  return k;
};

/** A column's type from its values: emails, numbers, dates and times, or text. */
function typeOf(values: string[]): Column["type"] {
  const v = values.filter((x) => x.trim()).slice(0, 50);
  if (!v.length) return "text";
  if (v.every((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) return "email";
  if (v.every((x) => /^-?[\d,]*\.?\d+%?$/.test(x.trim()))) return "number";
  if (v.every((x) => !Number.isNaN(Date.parse(x)) && /\d{4}|\d{1,2}[/:]\d{1,2}/.test(x))) return "time";
  return "text";
}

/** The Test version's table from an uploaded file: its header becomes the columns, its rows the data. */
export function tableFromCsv(fileName: string, text: string): DataTable | null {
  const rows = parseCsv(text);
  if (rows.length < 1) return null;
  const used = new Set<string>();
  const header = rows[0].map((h, i) => h.trim() || `Column ${i + 1}`);
  const keys = header.map((h, i) => keyOf(h, i, used));
  const body = rows.slice(1);
  const columns: Column[] = header.map((label, i) => ({ key: keys[i], label, type: typeOf(body.map((r) => r[i] ?? "")), about: `From ${fileName}` }));
  const data = body.slice(0, MAX_ROWS).map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
  const name = fileName.replace(/\.(csv|xlsx)$/i, "");
  return { key: `file-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, columns, rows: data, total: body.length, sample: false };
}

/** One spreadsheet row as a CSV line (for an Excel upload turned into CSV). */
export function csvLine(cells: unknown[]): string {
  return cells
    .map((c) => {
      const s = c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}
