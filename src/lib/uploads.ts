/** What can be attached to a request (Home's "Add files"): PDFs, CSV and Excel files, and images, a few at a time. */
export const UPLOAD_LIMITS = {
  maxFiles: 5,
  maxBytes: 10 * 1024 * 1024,
  // Browsers label CSVs "text/csv" or, on Windows, "application/vnd.ms-excel".
  types: ["application/pdf", "text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/png", "image/jpeg", "image/webp"],
  accept: ".pdf,.csv,.xlsx,.png,.jpg,.jpeg,.webp",
};

/** 1536 → "1.5 KB" */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A data file the Test version uses as its data: a CSV, or an Excel workbook (its first sheet). */
export const DATA_FILE = /\.(csv|xlsx)$/i;
