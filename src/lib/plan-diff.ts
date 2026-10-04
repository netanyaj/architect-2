import { z } from "zod";
import { GROUPS, ITEM_CLASSES, toKey, type Item } from "./blueprint";

/**
 * Changes to a plan from chat (A-11), the conflict guard (A-3) and version compare (A-5). Pure functions:
 * the server prices and saves; these decide what the next version contains.
 */

/** What the model fills for a chat request: relaxed like BlueprintDraft (Gemini rejects heavy schemas). */
export const ChangeDraft = z.object({
  reply: z.string(),
  add: z.array(
    z.object({
      key: z.string(),
      grp: z.enum(GROUPS),
      title: z.string(),
      description: z.string(),
      proved_when: z.string(),
      source_quote: z.string(),
      item_class: z.enum(ITEM_CLASSES),
      size: z.enum(["s", "m", "l"]),
      provider: z.string().optional(),
    }),
  ),
  change: z.array(z.object({ key: z.string(), title: z.string().optional(), description: z.string().optional(), proved_when: z.string().optional() })),
  remove: z.array(z.object({ key: z.string(), reason: z.string() })),
});
export type ChangeDraft = z.infer<typeof ChangeDraft>;

/** A part as a version holds it (only what the diff needs). */
export type VersionItem = {
  key: string;
  grp: string;
  title: string;
  description: string | null;
  proved_when: string;
  source_quote: string | null;
  item_class: string | null;
  size: string | null;
  provider: string | null;
  status: string;
  drop_reason?: string | null;
  position: number;
};

export type Diff = {
  add: (Pick<Item, "key" | "grp" | "title" | "description" | "proved_when" | "source_quote" | "item_class" | "size"> & { provider?: string })[];
  change: { key: string; title?: string; description?: string; proved_when?: string }[];
  remove: { key: string; reason: string }[];
};

/** Keep / Defer / Drop, recorded for every part a change would remove (A-3). */
export type Decision = { decision: "keep" | "defer" | "drop"; reason?: string };

const LIMITS = { title: 60, description: 200, proved_when: 160, source_quote: 120 } as const;
const clip = (s: string | undefined, n: number) => (s === undefined ? undefined : s.trim().slice(0, n));

/**
 * Tidies a model's change against the current parts: new keys valid and unique, changes and removals only for parts
 * that exist (and not already dropped), text within the schema's limits, empty edits removed.
 */
export function normalizeChange(draft: ChangeDraft, current: VersionItem[]): Diff {
  const live = new Set(current.filter((i) => i.status !== "dropped").map((i) => i.key));
  const used = new Set(current.map((i) => i.key));
  const add = draft.add.map((a) => {
    let key = toKey(a.key || a.title);
    for (let n = 2; used.has(key); n++) key = toKey(`${key.slice(0, 36)}-${n}`);
    used.add(key);
    return {
      key,
      grp: a.grp,
      title: clip(a.title, LIMITS.title)!,
      description: clip(a.description, LIMITS.description)!,
      proved_when: clip(a.proved_when, LIMITS.proved_when)!,
      source_quote: clip(a.source_quote, LIMITS.source_quote)!,
      item_class: a.item_class,
      size: a.size,
      ...(a.provider ? { provider: a.provider } : {}),
    };
  });
  const byKey = new Map(current.map((i) => [i.key, i]));
  const change = draft.change
    .filter((c) => live.has(c.key))
    .map((c) => {
      const was = byKey.get(c.key)!;
      const next = {
        key: c.key,
        title: clip(c.title, LIMITS.title),
        description: clip(c.description, LIMITS.description),
        proved_when: clip(c.proved_when, LIMITS.proved_when),
      };
      // Drop fields that don't actually change.
      if (next.title === was.title) delete next.title;
      if (next.description === (was.description ?? "")) delete next.description;
      if (next.proved_when === was.proved_when) delete next.proved_when;
      return next;
    })
    .filter((c) => c.title || c.description || c.proved_when);
  const remove = draft.remove.filter((r) => live.has(r.key)).map((r) => ({ key: r.key, reason: r.reason.trim().slice(0, 200) }));
  return { add, change, remove };
}

export function isEmpty(d: Diff): boolean {
  return d.add.length === 0 && d.change.length === 0 && d.remove.length === 0;
}

/** The parts a change would take away: each needs a recorded decision before Apply (A-3). */
export function conflictsOf(d: Diff, current: VersionItem[]): { key: string; title: string; reason: string }[] {
  const byKey = new Map(current.map((i) => [i.key, i]));
  return d.remove.map((r) => ({ key: r.key, title: byKey.get(r.key)?.title ?? r.key, reason: r.reason }));
}

/**
 * The next version's parts. Unchanged parts keep their status (built stays built); changed parts go back to
 * "agreed" after a build (or stay "proposed" before one); new parts start fresh. Removals follow the decisions:
 * keep → unchanged, defer → set aside, drop → struck through with the reason (they stay visible).
 * Throws if a removal has no decision: no part leaves a plan silently.
 */
export function applyDiff(current: VersionItem[], d: Diff, decisions: Record<string, Decision>, opts: { built: boolean }): VersionItem[] {
  const fresh = opts.built ? "agreed" : "proposed";
  const missing = d.remove.filter((r) => !decisions[r.key]);
  if (missing.length) throw new Error(`Decide what happens to: ${missing.map((m) => m.key).join(", ")}`);
  const dropWithoutReason = d.remove.filter((r) => decisions[r.key]?.decision === "drop" && !decisions[r.key]?.reason?.trim());
  if (dropWithoutReason.length) throw new Error("Dropping a part needs a reason.");

  const changes = new Map(d.change.map((c) => [c.key, c]));
  const removals = new Map(d.remove.map((r) => [r.key, decisions[r.key]]));
  const next = current.map((item) => {
    const c = changes.get(item.key);
    const r = removals.get(item.key);
    if (r?.decision === "defer") return { ...item, status: "deferred" };
    if (r?.decision === "drop") return { ...item, status: "dropped", drop_reason: r.reason!.trim() };
    if (c) {
      return {
        ...item,
        title: c.title ?? item.title,
        description: c.description ?? item.description,
        proved_when: c.proved_when ?? item.proved_when,
        status: item.status === "dropped" ? "dropped" : fresh,
      };
    }
    return item;
  });
  let position = Math.max(-1, ...current.map((i) => i.position));
  for (const a of d.add) {
    next.push({
      key: a.key,
      grp: a.grp,
      title: a.title,
      description: a.description,
      proved_when: a.proved_when,
      source_quote: a.source_quote,
      item_class: a.item_class,
      size: a.size,
      provider: a.provider ?? null,
      status: fresh,
      position: ++position,
    });
  }
  return next;
}

export type VersionCompare = {
  added: VersionItem[];
  changed: { before: VersionItem; after: VersionItem; fields: ("title" | "description" | "proved_when" | "status")[] }[];
  removed: VersionItem[];
};

/** Compare two versions by key (A-5): added, changed (with which fields) and removed or dropped parts. */
export function compareVersions(before: VersionItem[], after: VersionItem[]): VersionCompare {
  const old = new Map(before.map((i) => [i.key, i]));
  const now = new Map(after.map((i) => [i.key, i]));
  const added = after.filter((i) => !old.has(i.key));
  const removed = [
    ...before.filter((i) => !now.has(i.key)),
    ...after.filter((i) => i.status === "dropped" && old.get(i.key) && old.get(i.key)!.status !== "dropped"),
  ];
  const changed: VersionCompare["changed"] = [];
  for (const a of after) {
    const b = old.get(a.key);
    if (!b || (a.status === "dropped" && b.status !== "dropped")) continue;
    const fields = (["title", "description", "proved_when"] as const).filter((f) => (a[f] ?? "") !== (b[f] ?? ""));
    const statusChanged = a.status === "deferred" && b.status !== "deferred";
    if (fields.length || statusChanged) changed.push({ before: b, after: a, fields: statusChanged ? [...fields, "status"] : [...fields] });
  }
  return { added, changed, removed };
}
