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
  change: z.array(
    z.object({
      key: z.string(),
      // The model's label: "weaken" when the change makes a part do less than asked or be checked less strictly.
      kind: z.enum(["modify", "weaken"]),
      title: z.string().optional(),
      description: z.string().optional(),
      proved_when: z.string().optional(),
    }),
  ),
  remove: z.array(z.object({ key: z.string(), reason: z.string() })),
});

export type ChangeKind = "add" | "modify" | "weaken" | "remove";

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "each", "every", "is", "are", "be", "when", "that", "its", "it", "as", "at", "by", "from", "per"]);
const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
const numbers = (t: string): string[] => t.match(/\d+(\.\d+)?/g) ?? [];

/** A part's acceptance lines: its check split into the separate conditions it states. */
export function acceptanceLines(provedWhen: string): string[] {
  return provedWhen
    .split(/\n|;|\.\s+|,?\s+and\s+/i)
    .map((l) => l.trim().replace(/[.,]+$/, ""))
    .filter((l) => words(l).length > 0);
}

/** Is an old acceptance line still in the new check? Most of its words, and every number in it, must remain. */
function lineKept(line: string, next: string): boolean {
  const nextWords = new Set(words(next));
  const w = words(line);
  const kept = w.filter((x) => nextWords.has(x)).length / Math.max(1, w.length);
  const nums = numbers(line);
  return kept >= 0.7 && nums.every((n) => numbers(next).includes(n));
}

/**
 * The server's own weaken test (A-3), whatever the model labels: a new check with fewer acceptance lines than the
 * old one, or one that drops an old line (including changing a number in it), weakens the part.
 */
export function weakensCheck(before: string, after: string | undefined): boolean {
  if (after === undefined) return false;
  const old = acceptanceLines(before);
  return acceptanceLines(after).length < old.length || old.some((l) => !lineKept(l, after));
}
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
  change: { key: string; kind: "modify" | "weaken"; title?: string; description?: string; proved_when?: string }[];
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
      const next: Diff["change"][number] = {
        key: c.key,
        kind: c.kind,
        title: clip(c.title, LIMITS.title),
        description: clip(c.description, LIMITS.description),
        proved_when: clip(c.proved_when, LIMITS.proved_when),
      };
      // Drop fields that don't actually change.
      if (next.title === was.title) delete next.title;
      if (next.description === (was.description ?? "")) delete next.description;
      if (next.proved_when === was.proved_when) delete next.proved_when;
      // The model labels; the server decides: a check that loses a line (or a number) weakens the part.
      if (weakensCheck(was.proved_when, next.proved_when)) next.kind = "weaken";
      return next;
    })
    .filter((c) => c.title || c.description || c.proved_when);
  const remove = draft.remove.filter((r) => live.has(r.key)).map((r) => ({ key: r.key, reason: r.reason.trim().slice(0, 200) }));
  return { add, change, remove };
}

export function isEmpty(d: Diff): boolean {
  return d.add.length === 0 && d.change.length === 0 && d.remove.length === 0;
}

export type Conflict = { key: string; title: string; kind: "remove" | "weaken"; reason: string; before?: string; after?: string };

/** Parts a change would take away or weaken: each needs a recorded Keep / Defer / Drop decision before Apply (A-3). */
export function conflictsOf(d: Diff, current: VersionItem[]): Conflict[] {
  const byKey = new Map(current.map((i) => [i.key, i]));
  return [
    ...d.remove.map((r) => ({ key: r.key, title: byKey.get(r.key)?.title ?? r.key, kind: "remove" as const, reason: r.reason })),
    ...d.change
      .filter((c) => c.kind === "weaken")
      .map((c) => {
        const was = byKey.get(c.key);
        return {
          key: c.key,
          title: was?.title ?? c.key,
          kind: "weaken" as const,
          reason: c.proved_when ? "It would be checked less strictly." : "It would do less than you asked.",
          before: was?.proved_when,
          after: c.proved_when,
        };
      }),
  ];
}

/**
 * The next version's parts. Unchanged parts keep their status (built stays built); changed parts go back to
 * "agreed" after a build (or stay "proposed" before one); new parts start fresh. Removals follow the decisions:
 * keep → unchanged, defer → set aside, drop → struck through with the reason (they stay visible).
 * Throws if a removal has no decision: no part leaves a plan silently.
 */
export function applyDiff(current: VersionItem[], d: Diff, decisions: Record<string, Decision>, opts: { built: boolean }): VersionItem[] {
  const fresh = opts.built ? "agreed" : "proposed";
  // Removed and weakened parts both need a decision; Drop needs a reason (A-3).
  const guarded = [...d.remove.map((r) => r.key), ...d.change.filter((c) => c.kind === "weaken").map((c) => c.key)];
  const missing = guarded.filter((k) => !decisions[k]);
  if (missing.length) throw new Error(`Decide what happens to: ${missing.join(", ")}`);
  if (guarded.some((k) => decisions[k]?.decision === "drop" && !decisions[k]?.reason?.trim())) throw new Error("Dropping needs a reason.");

  const changes = new Map(d.change.map((c) => [c.key, c]));
  const removals = new Map(d.remove.map((r) => [r.key, decisions[r.key]]));
  const next = current.map((item) => {
    const c = changes.get(item.key);
    const r = removals.get(item.key);
    if (r?.decision === "defer") return { ...item, status: "deferred" };
    if (r?.decision === "drop") return { ...item, status: "dropped", drop_reason: r.reason!.trim() };
    if (c?.kind === "weaken") {
      // Keep = the part stays as asked (the weakening isn't applied); Defer = set the part aside;
      // Drop = drop the stronger version and accept the weaker one, with the reason recorded on the part.
      const w = decisions[c.key];
      if (w.decision === "keep") return item;
      if (w.decision === "defer") return { ...item, status: "deferred" };
    }
    if (c) {
      return {
        ...item,
        title: c.title ?? item.title,
        description: c.description ?? item.description,
        proved_when: c.proved_when ?? item.proved_when,
        status: item.status === "dropped" ? "dropped" : fresh,
        ...(c.kind === "weaken" ? { drop_reason: `Weakened: ${decisions[c.key].reason!.trim()}` } : {}),
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

/**
 * "Undo this change" (M5.8): the next version's parts with an applied change taken back. Parts the change added are
 * dropped ("Undone"); parts it changed or weakened get their wording back from the version before it; parts it removed
 * or set aside get back the status they had. Everything else stays as it is now (built stays built). A part that
 * gets its wording back after a build is rebuilt ("agreed"), like any changed part.
 */
export function undoDiff(current: VersionItem[], before: VersionItem[], d: Diff, opts: { built: boolean }): VersionItem[] {
  const fresh = opts.built ? "agreed" : "proposed";
  const was = new Map(before.map((i) => [i.key, i]));
  const added = new Set(d.add.map((a) => a.key));
  const changed = new Set(d.change.map((c) => c.key));
  const removed = new Set(d.remove.map((r) => r.key));
  return current.map((item) => {
    const b = was.get(item.key);
    if (added.has(item.key) && !b) return { ...item, status: "dropped", drop_reason: "Undone: this change was taken back" };
    if (!b) return item;
    if (removed.has(item.key)) return { ...item, status: b.status, drop_reason: b.drop_reason ?? null };
    if (changed.has(item.key)) {
      const same = (["title", "description", "proved_when"] as const).every((f) => (item[f] ?? "") === (b[f] ?? ""));
      if (same) return { ...item, drop_reason: b.drop_reason ?? null };
      return { ...item, title: b.title, description: b.description, proved_when: b.proved_when, drop_reason: b.drop_reason ?? null, status: item.status === "dropped" ? b.status : fresh };
    }
    return item;
  });
}
