import { describe, expect, it } from "vitest";
import { applyDiff, compareVersions, conflictsOf, isEmpty, normalizeChange, type ChangeDraft, type VersionItem } from "@/lib/plan-diff";

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
        change: [{ key: "nope", title: "X" }, { key: "brief-writer", title: "brief writer" }, { key: "talking-points", title: "Five talking points" }],
        remove: [{ key: "ghost", reason: "x" }],
      }),
      current,
    );
    expect(d.change).toEqual([{ key: "talking-points", title: "Five talking points" }]);
    expect(d.remove).toEqual([]);
    expect(isEmpty(normalizeChange(draft({}), current))).toBe(true);
  });
});

describe("applyDiff (A-11, A-3)", () => {
  it("built parts stay built, changed ones go back to agreed after a build, new ones start agreed", () => {
    const d = normalizeChange(
      draft({
        change: [{ key: "talking-points", title: "Five talking points" }],
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
    expect(conflictsOf(d, current)).toEqual([{ key: "agenda-summary", title: "agenda summary", reason: "You asked to skip PDFs" }]);
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
