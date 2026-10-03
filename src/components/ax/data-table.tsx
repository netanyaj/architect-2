import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Column<Row> = {
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** Right-align numbers. */
  numeric?: boolean;
  className?: string;
};

/**
 * Tables for data: a tray header row, 14px cells, hairline rows. Wide tables scroll inside their box.
 * Filters and Export go above (`toolbar`); pagination below (`footer`).
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  toolbar,
  footer,
  empty,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  caption: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  empty?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      {rows.length === 0 && empty ? (
        empty
      ) : (
        <div className="overflow-x-auto rounded-card border border-line">
          <table className="w-full border-collapse text-body">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={cn(
                      "border-b border-line bg-tray px-3.5 py-2.5 text-left text-small font-[650] whitespace-nowrap text-ink-2",
                      c.numeric && "text-right",
                    )}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)} className="border-b border-line last:border-b-0">
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3.5 py-3", c.numeric && "text-right tabular-nums", c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footer}
    </div>
  );
}
