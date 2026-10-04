import { describe, expect, it } from "vitest";
import { acceptanceLines, applyDiff, compareVersions, conflictsOf, isEmpty, normalizeChange, weakensCheck, type ChangeDraft, type VersionItem } from "@/lib/plan-diff";

const part = (key: string, status = "proposed", position = 0): VersionItem => ({
  key,
  grp: "features",
  title: key.replace(/-/g, " "),
  description: "d",
  proved_when: "p",
  source_quote: "q",
  item_class: "screen.list",
  size: "m",
  provider: null,
  status,
  position,
});
const current = [part("brief-writer", "built", 0), part("talking-points", "built", 1), part("agenda-summary", "proposed", 2)];
const draft = (d: Partial<ChangeDraft>): ChangeDraft => ({ reply: "ok", add: [], change: [], remove: [], ...d });

describe("normalizeChange", () => {
  it("gives new parts valid unique keys and trims text to the plan's limits", () => {
    const d = normalizeChange(
      draft({ add: [{ key: "Brief Writer", grp: "features", title: "x".repeat(80), description: "Friday recap", proved_when: "p", source_quote: "send me a Friday recap", item_class: "quality.schedule", size: "s" }] }),
      current,
    );
    expect(d.add[0].key).toBe("brief-writer-2");
    expect(d.add[0].title).toHaveLength(60);
  });
  it("ignores changes and removals for parts that don't exist, and edits that change nothing", () => {
    const d = normalizeChange(
      draft({
        change: [{ key: "nope", kind: "modify", title: "X" }, { key: "brief-writer", kind: "modify", title: "brief writer" }, { key: "talking-points", kind: "modify", title: "Five talking points" }],
        remove: [{ key: "ghost", reason: "x" }],
      }),
      current,
    );
    expect(d.change).toEqual([{ key: "talking-points", kind: "modify", title: "Five talking points" }]);
    expect(d.remove).toEqual([]);
    expect(isEmpty(normalizeChange(draft({}), current))).toBe(true);
  });
});

describe("applyDiff (A-11, A-3)", () => {
  it("built parts stay built, changed ones go back to agreed after a build, new ones start agreed", () => {
    const d = normalizeChange(
      draft({
        change: [{ key: "talking-points", kind: "modify", title: "Five talking points" }],
        add: [{ key: "friday-recap", grp: "features", title: "Friday recap", description: "d", proved_when: "p", source_quote: "Friday recap", item_class: "quality.schedule", size: "s" }],
      }),
      current,
    );
    const next = applyDiff(current, d, {}, { built: true });
    expect(next.map((i) => [i.key, i.status])).toEqual([
      ["brief-writer", "built"],
      ["talking-points", "agreed"],
      ["agenda-summary", "proposed"],
      ["friday-recap", "agreed"],
    ]);
    expect(next.at(-1)!.position).toBe(3);
  });

  it("no part leaves silently: a removal needs Keep, Defer or Drop, and Drop needs a reason", () => {
    const d = normalizeChange(draft({ remove: [{ key: "agenda-summary", reason: "You asked to skip PDFs" }] }), current);
    expect(conflictsOf(d, current)).toEqual([{ key: "agenda-summary", title: "agenda summary", kind: "remove", reason: "You asked to skip PDFs" }]);
    expect(() => applyDiff(current, d, {}, { built: false })).toThrow("Decide what happens to: agenda-summary");
    expect(() => applyDiff(current, d, { "agenda-summary": { decision: "drop" } }, { built: false })).toThrow("needs a reason");

    expect(applyDiff(current, d, { "agenda-summary": { decision: "keep" } }, { built: false })[2].status).toBe("proposed");
    expect(applyDiff(current, d, { "agenda-summary": { decision: "defer" } }, { built: false })[2].status).toBe("deferred");
    const dropped = applyDiff(current, d, { "agenda-summary": { decision: "drop", reason: "Not needed" } }, { built: false })[2];
    expect(dropped).toMatchObject({ status: "dropped", drop_reason: "Not needed" }); // stays visible, struck through
  });
});

describe("compareVersions (A-5)", () => {
  it("lists added, changed (with fields) and removed or dropped parts", () => {
    const before = [part("a", "built"), part("b"), part("c"), part("d")];
    const after = [{ ...part("a", "built"), title: "A, renamed" }, part("b"), { ...part("c"), status: "dropped" }, { ...part("d"), status: "deferred" }, part("e")];
    const cmp = compareVersions(before, after);
    expect(cmp.added.map((i) => i.key)).toEqual(["e"]);
    expect(cmp.removed.map((i) => i.key)).toEqual(["c"]);
    expect(cmp.changed.map((c) => [c.after.key, c.fields])).toEqual([
      ["a", ["title"]],
      ["d", ["status"]],
    ]);
  });
});

describe("weaken: the model labels, the server decides (A-3)", () => {
  const brief = { ...part("brief-writer", "built", 0), proved_when: "The brief is 200 words or fewer and lists three talking points" };
  const items = [brief, part("agenda-summary", "proposed", 1)];

  it("splits a check into its acceptance lines", () => {
    expect(acceptanceLines(brief.proved_when)).toEqual(["The brief is 200 words or fewer", "lists three talking points"]);
  });

  it("treats a check that loses a line, or changes a number, as weaken whatever the model says", () => {
    expect(weakensCheck(brief.proved_when, "The brief is 200 words or fewer")).toBe(true); // a line dropped
    expect(weakensCheck(brief.proved_when, "The brief is 400 words or fewer and lists three talking points")).toBe(true); // 200 → 400
    expect(weakensCheck(brief.proved_when, "The brief is 200 words or fewer, lists three talking points and links the agenda")).toBe(false); // stricter
    const d = normalizeChange(draft({ change: [{ key: "brief-writer", kind: "modify", proved_when: "The brief lists three talking points" }] }), items);
    expect(d.change[0].kind).toBe("weaken");
  });

  it("the model's own weaken label is kept even when the check is untouched", () => {
    const d = normalizeChange(draft({ change: [{ key: "brief-writer", kind: "weaken", description: "Only for external meetings" }] }), items);
    expect(d.change[0].kind).toBe("weaken");
  });

  it("a weakening gets the Keep / Defer / Drop card, like a removal", () => {
    const d = normalizeChange(draft({ change: [{ key: "brief-writer", kind: "modify", proved_when: "The brief lists three talking points" }] }), items);
    expect(conflictsOf(d, items)).toEqual([
      expect.objectContaining({ key: "brief-writer", kind: "weaken", before: brief.proved_when, after: "The brief lists three talking points" }),
    ]);
    expect(() => applyDiff(items, d, {}, { built: true })).toThrow("Decide what happens to: brief-writer");
    expect(() => applyDiff(items, d, { "brief-writer": { decision: "drop" } }, { built: true })).toThrow("needs a reason");
    // Keep: stays as asked. Defer: set aside. Drop: the weaker version, with the reason on the part.
    expect(applyDiff(items, d, { "brief-writer": { decision: "keep" } }, { built: true })[0]).toEqual(brief);
    expect(applyDiff(items, d, { "brief-writer": { decision: "defer" } }, { built: true })[0].status).toBe("deferred");
    const dropped = applyDiff(items, d, { "brief-writer": { decision: "drop", reason: "Length doesn't matter to me" } }, { built: true })[0];
    expect(dropped).toMatchObject({ proved_when: "The brief lists three talking points", status: "agreed", drop_reason: "Weakened: Length doesn't matter to me" });
  });

  it("a plain modify that keeps every line needs no decision", () => {
    const d = normalizeChange(draft({ change: [{ key: "brief-writer", kind: "modify", title: "Meeting brief" }] }), items);
    expect(conflictsOf(d, items)).toEqual([]);
    expect(applyDiff(items, d, {}, { built: true })[0]).toMatchObject({ title: "Meeting brief", status: "agreed" });
  });
});
