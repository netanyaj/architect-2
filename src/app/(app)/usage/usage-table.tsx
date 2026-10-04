"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ax/button";
import { DataTable } from "@/components/ax/data-table";
import { EmptyState } from "@/components/ax/empty-state";
import { Select } from "@/components/ax/select";

export type LedgerRow = { id: string; at: string; project: string; kind: string; note: string; credits: number };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Quotes a CSV field when it needs it. */
export function csvField(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function UsageTable({ rows }: { rows: LedgerRow[] }) {
  const [project, setProject] = useState("all");
  const selectId = useId();
  const projects = Array.from(new Set(rows.map((r) => r.project))).sort();
  const shown = project === "all" ? rows : rows.filter((r) => r.project === project);
  const total = Math.round(shown.reduce((s, r) => s + r.credits, 0));

  const exportCsv = () => {
    const lines = [["When", "Project", "Kind", "What", "Credits"], ...shown.map((r) => [r.at, r.project, r.kind, r.note, r.credits])];
    const blob = new Blob([lines.map((l) => l.map(csvField).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `architect-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (rows.length === 0) {
    return (
      <EmptyState icon="usage" title="Nothing spent yet">
        Writing a plan, building and fixing each add a line here. Nothing is charged until you click Build.
      </EmptyState>
    );
  }

  return (
    <DataTable
      caption="Usage lines"
      rows={shown}
      rowKey={(r) => r.id}
      toolbar={
        <>
          <label htmlFor={selectId} className="text-small font-semibold">
            Project
          </label>
          <Select id={selectId} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <span className="flex-1" />
          <span className="text-small text-ink-2 tabular-nums">
            {shown.length} {shown.length === 1 ? "line" : "lines"} · {total.toLocaleString("en-US")} credits
          </span>
          <Button size="sm" icon="download" onClick={exportCsv}>
            Export CSV
          </Button>
        </>
      }
      columns={[
        { key: "at", header: "When", cell: (r) => <span className="whitespace-nowrap text-ink-2">{fmtDate(r.at)}</span> },
        { key: "project", header: "Project", cell: (r) => r.project },
        { key: "kind", header: "Kind", cell: (r) => r.kind },
        { key: "note", header: "What", cell: (r) => r.note },
        { key: "credits", header: "Credits", numeric: true, cell: (r) => r.credits.toLocaleString("en-US") },
      ]}
    />
  );
}
