"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";
import { SimTag, Tag } from "@/components/ax/pill";
import { Segmented } from "@/components/ax/segmented";
import { Select } from "@/components/ax/select";
import { appTables, appUsers, filterRows, SIGN_IN_LABEL, toCsv, VERSION_LABEL, type DataVersion } from "@/lib/app-data";
import { cn } from "@/lib/utils";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";

const PAGE = 8;
const USERS = "users";

function StatusCell({ value }: { value: string }) {
  // Colour means status only: done is works, failed is failed, everything else is neutral ink.
  const tone = /^(sent|done|handled)$/i.test(value) ? "bg-works text-works" : /^(failed|overdue)$/i.test(value) ? "bg-failed text-failed" : "bg-ink text-ink";
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-[650]", tone.split(" ")[1])}>
      <i className={cn("block size-2 rounded-full", tone.split(" ")[0])} aria-hidden="true" />
      {value}
    </span>
  );
}

/**
 * Data (screen 13), simulated: what the app stores, per version. Test version data by default; the team version
 * and Live once they exist, Live read-only. Rows or Columns, a filter, Export CSV, and the app's sign-ins.
 */
export function DataView({ project, items }: { project: ProjectWorkspace; items: WorkspaceItem[] }) {
  const [version, setVersion] = useState<DataVersion>("test");
  // The test version's data: an uploaded CSV or Excel file is parsed for real and shown first, "From your file";
  // everything else in the test version is sample data. Team and Live grow with use (simulated).
  const fileKeys = new Set(project.data.fileTables.map((t) => t.key));
  const tables = useMemo(
    () => [
      ...(version === "test" ? project.data.fileTables : []),
      ...appTables({ projectId: project.id, projectName: project.name, parts: items.map((i) => ({ key: i.key, title: i.title, grp: i.grp, status: i.status })), version }),
    ],
    [project.id, project.name, project.data.fileTables, items, version],
  );
  const users = useMemo(() => appUsers({ projectId: project.id, version, method: project.data.signIn, domain: project.data.domain }), [project.id, project.data, version]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"rows" | "columns">("rows");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  // Rows added or removed here (Test and Team only), by version and table. Not saved: the data is simulated.
  const [edits, setEdits] = useState<Record<string, { added: Record<string, string>[]; removed: number[] }>>({});

  const readOnly = version === "live" ? "Live data is read-only here. Change it in the app, or in the test version first." : undefined;
  const key = selected ?? tables[0]?.key ?? USERS;
  const isUsers = key === USERS;
  const t = tables.find((x) => x.key === key);
  const columns = isUsers
    ? [
        { key: "name", label: "Name", type: "people" as const, about: "Who signed in" },
        { key: "email", label: "Email", type: "email" as const, about: "Their sign-in email" },
        { key: "via", label: "Signed in with", type: "text" as const, about: SIGN_IN_LABEL[project.data.signIn] },
        { key: "last", label: "Last sign-in", type: "time" as const, about: "When they last signed in" },
        { key: "role", label: "Role", type: "text" as const, about: "Owner or user of the app" },
      ]
    : (t?.columns ?? []);
  const edit = edits[`${version}:${key}`] ?? { added: [], removed: [] };
  const base: Record<string, string>[] = isUsers ? users : (t?.rows ?? []);
  const all = [...edit.added, ...base.filter((_, i) => !edit.removed.includes(i))];
  const total = isUsers ? all.length : (t ? t.total + edit.added.length - edit.removed.length : 0);
  const rows = filterRows(all, filter);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const name = isUsers ? "People who can sign in" : (t?.name ?? "");

  const choose = (k: string) => {
    setSelected(k);
    setFilter("");
    setPage(0);
  };
  const exportCsv = () => {
    const blob = new Blob([toCsv(columns, rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name}-${name}-${version}.csv`.toLowerCase().replace(/[^a-z0-9.-]+/g, "-");
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const addRow = () =>
    setEdits((e) => ({
      ...e,
      [`${version}:${key}`]: { ...edit, added: [Object.fromEntries(columns.map((c) => [c.key, c.type === "time" ? "Just now" : c.type === "status" ? "New" : `New ${c.label.toLowerCase()}`])), ...edit.added] },
    }));
  const removeRow = (row: Record<string, string>) => {
    const added = edit.added.indexOf(row);
    if (added >= 0) return setEdits((e) => ({ ...e, [`${version}:${key}`]: { ...edit, added: edit.added.filter((_, i) => i !== added) } }));
    const index = base.indexOf(row);
    setEdits((e) => ({ ...e, [`${version}:${key}`]: { ...edit, removed: [...edit.removed, index] } }));
  };

  if (!tables.length && !project.items.some((i) => ["built", "sample_data", "needs_connection"].includes(i.status))) {
    // (A project with an uploaded data file has its table even before it's built.)
    return (
      <EmptyState icon="grid" title="No data yet">
        Once the app is built, its tables and the people who sign in show here, test version data first.
      </EmptyState>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
      <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
        <SimTag title="Sample data is simulated, seeded from the app's parts. Data from your file is parsed from the file you uploaded." />
        <label className="sr-only" htmlFor="data-version">
          Which version&apos;s data
        </label>
        <Select id="data-version" value={version} onChange={(e) => {
            setVersion(e.target.value as DataVersion);
            setPage(0);
            setFilter("");
          }} controlSize="md">
          <option value="test">{VERSION_LABEL.test}</option>
          <option value="team" disabled={!project.data.envs.staging}>
            {VERSION_LABEL.team}
            {project.data.envs.staging ? "" : " (not shared yet)"}
          </option>
          <option value="live" disabled={!project.data.envs.production}>
            {VERSION_LABEL.live}
            {project.data.envs.production ? " (read-only)" : " (not live yet)"}
          </option>
        </Select>
      </div>
      <div className="flex min-h-0 flex-1 rounded-card border border-line max-lg:flex-col">
        <nav aria-label="Tables" className="flex w-[250px] flex-none flex-col gap-1 overflow-auto rounded-l-card bg-tray p-2.5 max-lg:w-full">
          <h3 className="px-2 pt-1 pb-1 font-[650]">What the app stores</h3>
          {tables.map((x) => (
            <button key={x.key} type="button" aria-current={key === x.key ? "true" : undefined} onClick={() => choose(x.key)} className={cn("flex flex-col rounded-tile px-2 py-1.5 text-left hover:bg-selected", key === x.key && "bg-selected")}>
              <span>{x.name}</span>
              <span className="text-small text-ink-2">{fileKeys.has(x.key) ? `From your file · ${x.total} ${x.total === 1 ? "row" : "rows"}` : x.sample || version === "test" ? "Sample data" : `${x.total} saved`}</span>
            </button>
          ))}
          <h3 className="px-2 pt-3 pb-1 font-[650]">Sign-in</h3>
          <button type="button" aria-current={isUsers ? "true" : undefined} onClick={() => choose(USERS)} className={cn("flex flex-col rounded-tile px-2 py-1.5 text-left hover:bg-selected", isUsers && "bg-selected")}>
            <span>People who can sign in</span>
            <span className="text-small text-ink-2">
              {users.length} · {SIGN_IN_LABEL[project.data.signIn]}
            </span>
          </button>
          <p className="px-2 pt-3 text-small text-ink-2">Each version has its own data. Live data is read-only here.</p>
        </nav>
        <section aria-label={name} className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <h3 className="font-[650]">{name}</h3>
            {!isUsers && <Tag>{fileKeys.has(key) ? "From your file" : version === "test" || t?.sample ? "Sample data" : "Saved data"}</Tag>}
            <Segmented
              label="Show"
              value={mode}
              onChange={setMode}
              options={[
                { value: "rows", label: "Rows" },
                { value: "columns", label: "Columns" },
              ]}
            />
            <span className="flex-1" />
            <label className="sr-only" htmlFor="data-filter">
              Filter rows
            </label>
            <input
              id="data-filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
              placeholder="Filter…"
              className="min-h-[34px] w-44 rounded-full border border-line-ctl bg-surface px-3.5 text-body"
            />
            <Button size="sm" onClick={exportCsv}>
              Export CSV
            </Button>
            {!isUsers && (
              <Button size="sm" icon="plus" disabledReason={readOnly} onClick={addRow}>
                Add a row
              </Button>
            )}
            {/* Rows added or removed here last until the page reloads: say so where the edit happens. */}
            {!isUsers && !readOnly && <span className="text-small text-ink-2">Changes here aren&apos;t saved: they last until the page reloads.</span>}
          </div>
          {readOnly && <p className="px-4 pb-2 text-small text-ink-2">{readOnly}</p>}
          {mode === "columns" ? (
            <table className="w-full text-left text-body">
              <thead className="bg-tray text-small text-ink-2">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Column</th>
                  <th className="px-4 py-2.5 font-semibold">Kind</th>
                  <th className="px-4 py-2.5 font-semibold">What it holds</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.key} className="border-t border-line">
                    <td className="px-4 py-2.5 font-[550]">{c.label}</td>
                    <td className="px-4 py-2.5 text-ink-2">{{ text: "Text", people: "People", status: "Status", time: "Date and time", number: "Number", email: "Email" }[c.type]}</td>
                    <td className="px-4 py-2.5 text-ink-2">{c.about}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-left text-body">
                <thead className="bg-tray text-small text-ink-2">
                  <tr>
                    {columns.map((c) => (
                      <th key={c.key} className="px-4 py-2.5 font-semibold">
                        {c.label}
                      </th>
                    ))}
                    {!isUsers && <th className="w-10 px-2"><span className="sr-only">Remove</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row, i) => (
                    <tr key={`${page}-${i}`} className="border-t border-line">
                      {columns.map((c) => (
                        <td key={c.key} className="px-4 py-2.5">
                          {c.type === "status" ? <StatusCell value={row[c.key]} /> : row[c.key]}
                        </td>
                      ))}
                      {!isUsers && (
                        <td className="px-2">
                          <Button size="sm" variant="quiet" aria-label="Remove this row" disabledReason={readOnly} onClick={() => removeRow(row)}>
                            Remove
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!shown.length && (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-4 py-6 text-center text-ink-2">
                        {filter ? `No rows match “${filter}”.` : "No rows yet."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {mode === "rows" && (
            <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
              <span className="flex-1 text-small text-ink-2 tabular-nums">
                {rows.length ? `${page * PAGE + 1}–${page * PAGE + shown.length} of ${filter ? rows.length : total}` : "0 rows"}
                {filter ? ` matching “${filter}”` : ""}
              </span>
              <Button size="sm" variant="quiet" disabledReason={page === 0 ? "This is the first page." : undefined} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button size="sm" disabledReason={page >= pages - 1 ? "This is the last page." : undefined} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
