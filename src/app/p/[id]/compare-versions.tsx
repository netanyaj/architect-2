"use client";

import { useEffect, useId, useState } from "react";
import { TextLink } from "@/components/ax/button";
import { Drawer } from "@/components/ax/drawer";
import { Select } from "@/components/ax/select";
import { compareVersions, type VersionCompare, type VersionItem } from "@/lib/plan-diff";
import { loadVersionItems } from "@/server/actions/plan";
import type { PlanVersion } from "@/server/project";

const FIELD: Record<string, string> = { title: "name", description: "what it does", proved_when: "its check", status: "set aside" };

/** Compare any two versions of the plan, matched by part (A-5): added, changed and removed or dropped. */
export function CompareVersions({ versions }: { versions: PlanVersion[] }) {
  const ready = versions.filter((v) => v.generation === "ready");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(ready[1]?.id ?? "");
  const [to, setTo] = useState(ready[0]?.id ?? "");
  const [result, setResult] = useState<VersionCompare | null>(null);
  const [error, setError] = useState<string>();
  const ids = { from: useId(), to: useId() };

  useEffect(() => {
    if (!open || !from || !to) return;
    let live = true;
    void (async () => {
      const [a, b] = await Promise.all([loadVersionItems({ blueprintId: from }), loadVersionItems({ blueprintId: to })]);
      if (!live) return;
      if (!a.ok || !b.ok) return setError((!a.ok && a.message) || (!b.ok && b.message) || "Couldn't load the versions.");
      setError(undefined);
      setResult(compareVersions(a.items as VersionItem[], b.items as VersionItem[]));
    })();
    return () => {
      live = false;
    };
  }, [open, from, to]);

  if (ready.length < 2) return null;
  const label = (id: string) => `v${versions.find((v) => v.id === id)?.version}`;
  const empty = result && !result.added.length && !result.changed.length && !result.removed.length;

  return (
    <>
      <TextLink onClick={() => setOpen(true)}>Compare versions</TextLink>
      <Drawer open={open} onOpenChange={setOpen} title="Compare versions" state="Parts are matched across versions, so renamed parts show as changed.">
        <div className="flex flex-wrap items-end gap-3">
          {(["from", "to"] as const).map((k) => (
            <div key={k} className="flex flex-col gap-1.5">
              <label htmlFor={ids[k]} className="text-small font-semibold">
                {k === "from" ? "From" : "To"}
              </label>
              <Select id={ids[k]} controlSize="md" value={k === "from" ? from : to} onChange={(e) => (k === "from" ? setFrom : setTo)(e.target.value)}>
                {ready.map((v) => (
                  <option key={v.id} value={v.id}>
                    v{v.version}
                    {v.status === "agreed" ? " · agreed" : v.status === "superseded" ? "" : " · draft"}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        {from === to && <p className="text-ink-2">Pick two different versions.</p>}
        {result && from !== to && (
          <div className="flex flex-col gap-4" aria-live="polite">
            {empty && <p className="text-ink-2">{label(from)} and {label(to)} have the same parts.</p>}
            {result.added.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="font-[650]">Added in {label(to)}</h3>
                <ul className="flex flex-col gap-1">
                  {result.added.map((i) => (
                    <li key={i.key}>
                      <b>{i.title}</b> <span className="text-small text-ink-2">· done when {i.proved_when.charAt(0).toLowerCase() + i.proved_when.slice(1)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {result.changed.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="font-[650]">Changed</h3>
                <ul className="flex flex-col gap-2">
                  {result.changed.map((c) => (
                    <li key={c.after.key} className="flex flex-col">
                      <b>{c.after.title}</b>
                      <span className="text-small text-ink-2">Changed: {c.fields.map((f) => FIELD[f]).join(", ")}</span>
                      {c.fields.includes("title") && <span className="text-small text-ink-3">Was “{c.before.title}”</span>}
                      {c.fields.includes("proved_when") && <span className="text-small text-ink-3">Check was: {c.before.proved_when}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {result.removed.length > 0 && (
              <section className="flex flex-col gap-1.5">
                <h3 className="font-[650]">Removed or dropped</h3>
                <ul className="flex flex-col gap-1">
                  {result.removed.map((i) => (
                    <li key={i.key}>
                      <b className="line-through">{i.title}</b>
                      {i.drop_reason && <span className="text-small text-ink-2"> · {i.drop_reason}</span>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Drawer>
    </>
  );
}
