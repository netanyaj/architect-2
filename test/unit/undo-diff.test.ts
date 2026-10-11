import { describe, expect, it } from "vitest";
import { applyDiff, undoDiff, type Diff, type VersionItem } from "@/lib/plan-diff";

/* M5.8: "Undo this change" takes an applied change back as a new version. */
const part = (key: string, extra: Partial<VersionItem> = {}): VersionItem => ({
  key,
  grp: "features",
  title: key,
  description: null,
  proved_when: `${key} works`,
  source_quote: null,
  item_class: "screen.list",
  size: "s",
  provider: null,
  status: "built",
  position: 0,
  ...extra,
});

describe("undoDiff", () => {
  const v1 = [part("brief"), part("agenda"), part("slack-dm", { proved_when: "A DM arrives within 1 minute" })];
  const diff: Diff = {
    add: [{ key: "friday-recap", grp: "features", title: "Friday recap", description: "Posts a recap", proved_when: "A recap is posted", source_quote: "recap", item_class: "screen.list", size: "s" }],
    change: [{ key: "slack-dm", kind: "weaken", proved_when: "A DM arrives" }],
    remove: [{ key: "agenda", reason: "Not needed" }],
  };
  const v2 = applyDiff(v1, diff, { agenda: { decision: "drop", reason: "Not needed" }, "slack-dm": { decision: "drop", reason: "Faster is fine" } }, { built: true });

  it("drops what the change added, restores what it changed and what it removed", () => {
    const v3 = undoDiff(v2, v1, diff, { built: true });
    const by = new Map(v3.map((i) => [i.key, i]));
    expect(by.get("friday-recap")).toMatchObject({ status: "dropped", drop_reason: expect.stringMatching(/^Undone/) });
    expect(by.get("agenda")).toMatchObject({ status: "built", drop_reason: null });
    expect(by.get("slack-dm")).toMatchObject({ proved_when: "A DM arrives within 1 minute", status: "agreed", drop_reason: null });
    expect(by.get("brief")).toMatchObject({ status: "built" });
  });

  it("before a build, restored parts stay proposed", () => {
    const pre = v1.map((i) => ({ ...i, status: "proposed" }));
    const v2pre = applyDiff(pre, diff, { agenda: { decision: "defer" }, "slack-dm": { decision: "drop", reason: "ok" } }, { built: false });
    const v3 = undoDiff(v2pre, pre, diff, { built: false });
    expect(v3.find((i) => i.key === "agenda")!.status).toBe("proposed");
    expect(v3.find((i) => i.key === "slack-dm")!.status).toBe("proposed");
  });
});
