import { describe, expect, it } from "vitest";
import { buildLogs, consoleCounts, consoleEntries, fixRequest, liveLogs, promptLine } from "@/lib/dev-panel";

/* The Developer panel (M5.10): the prompt, the console from the parts, build logs per part, and live logs. */

const part = (key: string, title: string, status: string, grp = "features", provider: string | null = null, statusDetail: string | null = null) => ({ key, title, status, grp, provider, statusDetail });
const parts = [
  part("claims", "Claims list", "built"),
  part("policy", "Policy check", "failed", "features", null, "3 of 5 assertions passed: amounts over the limit weren't flagged"),
  part("slack", "Weekly summary to Slack", "sample_data", "integrations", "slack"),
  part("gone", "Receipts", "dropped"),
];

describe("Developer panel", () => {
  it("starts the terminal with the project's prompt line", () => {
    expect(promptLine("Expense checker", "main")).toBe("~/expense-checker (main) $");
  });

  it("console: an error per failing part, a warning per part on sample data, a log per working part; dropped parts aren't there", () => {
    const entries = consoleEntries(parts);
    expect(entries.map((e) => [e.level, e.partKey])).toEqual([
      ["error", "policy"],
      ["warn", "slack"],
      ["log", "claims"],
    ]);
    expect(consoleCounts(entries)).toEqual({ all: 3, error: 1, warn: 1, log: 1 });
    expect(entries[0]).toMatchObject({ text: "Policy check: 3 of 5 assertions passed: amounts over the limit weren't flagged", source: "app/policy-check.ts" });
    expect(fixRequest(entries[0])).toBe("Fix this error from the preview's console: Policy check: 3 of 5 assertions passed: amounts over the limit weren't flagged (in app/policy-check.ts).");
  });

  it("build logs: one collapsible log per part, in build order", () => {
    const ev = (id: string, type: string, itemKey: string | null, payload: Record<string, unknown> = {}) => ({ id, type, itemKey, atMs: 0, payload }) as never;
    const logs = buildLogs({
      events: [ev("1", "run.started", null, { total_items: 2 }), ev("2", "item.building", "policy"), ev("3", "item.building", "claims"), ev("4", "item.built", "claims", { assertions: 3 }), ev("5", "item.failed", "policy", { reason: "limit not flagged" })],
      titles: { claims: "Claims list", policy: "Policy check" },
      parts,
    });
    expect(logs.map((l) => [l.key, l.status, l.lines.length])).toEqual([
      ["policy", "failed", 3],
      ["claims", "built", 3],
    ]);
    expect(logs[1].lines.at(-1)).toEqual({ kind: "ok", text: "✓ 3 of 3 assertions passed" });
  });

  it("live logs: none for an environment that isn't deployed; the same lines every time for one that is", () => {
    const now = new Date("2026-10-12T10:00:00Z");
    expect(liveLogs({ projectId: "p1", env: "live", deployed: false, parts, now })).toEqual([]);
    const a = liveLogs({ projectId: "p1", env: "live", deployed: true, parts, now });
    expect(a).toHaveLength(14);
    // Oldest first, all before now.
    expect([...a].sort((x, y) => x.at.localeCompare(y.at))).toEqual(a);
    expect(a.at(-1)!.at <= now.toISOString()).toBe(true);
    expect(liveLogs({ projectId: "p1", env: "live", deployed: true, parts, now })).toEqual(a);
    expect(a.some((l) => l.text.startsWith("GET /claims-list 200"))).toBe(true);
    expect(a.filter((l) => l.level === "warn").every((l) => l.text === "slack: not connected, served sample data")).toBe(true);
  });
});

describe("assertion counts from the simulator", () => {
  it("reads [passed, total] and the older single number", async () => {
    const { assertionCounts } = await import("@/lib/dev-view");
    expect(assertionCounts([3, 4])).toEqual({ passed: 3, total: 4 });
    expect(assertionCounts(5)).toEqual({ passed: 5, total: 5 });
    expect(assertionCounts(undefined)).toEqual({ passed: 1, total: 1 });
  });
});
