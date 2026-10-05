import { describe, expect, it } from "vitest";
import { DomainName, launchState, Listing, runningCredits, type Deployment, type LaunchPart } from "@/lib/launch";

const part = (key: string, status: string, provider: string | null = null): LaunchPart => ({ id: `id-${key}`, key, title: key.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()), status, provider, estimate: 10 });
const dep = (environment: "staging" | "production", version: number, createdAt = "2026-10-06T10:00:00Z"): Deployment => ({ id: `${environment}-${version}`, environment, version, status: "live", createdAt, by: null });
const base = { deployments: [] as Deployment[], envLive: { staging: false, production: false }, currentVersion: 1, role: "owner" as const, governance: true, liveRequested: false, testsPassed: 12 };

describe("launchState", () => {
  it("a part waiting for a connection or using sample data must be fixed before the team version (screen 4)", () => {
    const s = launchState({ ...base, parts: [part("brief", "built"), part("last-email", "needs_connection", "gmail"), part("notes-archive", "sample_data")] });
    expect(s.rows.map((r) => [r.kind, r.title])).toEqual([
      ["connect", "Connect Gmail for your team"],
      ["sample", "Notes archive still uses sample data"],
      ["fine", "Tests, security and privacy checks passed"],
    ]);
    expect(s.progress).toBe("2 things before sharing");
    expect(s.share).toEqual({ label: "Share with your team", disabledReason: "Fix 2 things in the checklist first." });
    expect(s.goLive.disabledReason).toMatch(/^Share this version with your team first/);
  });

  it("parts set aside don't count; parts not built do", () => {
    const s = launchState({ ...base, parts: [part("a", "built"), part("b", "deferred"), part("c", "agreed")] });
    expect(s.rows[0]).toMatchObject({ kind: "unbuilt", title: "1 part isn't built" });
  });

  it("clear checklist: Share is the action; then Live, which an Owner can do and a Builder asks for", () => {
    const parts = [part("a", "built"), part("b", "built")];
    expect(launchState({ ...base, parts }).share.disabledReason).toBeUndefined();
    const shared = launchState({ ...base, parts, deployments: [dep("staging", 1)] });
    expect(shared).toMatchObject({ team: { version: 1, current: true }, progress: "ready to go live", goLive: { label: "Go live", request: false } });
    expect(shared.goLive.disabledReason).toBeUndefined();
    const builder = launchState({ ...base, role: "builder", parts, deployments: [dep("staging", 1)] });
    expect(builder.goLive).toMatchObject({ label: "Ask to go live", request: true });
    expect(launchState({ ...base, role: "builder", parts, deployments: [dep("staging", 1)], liveRequested: true }).goLive.disabledReason).toBe("Your request is waiting for an Owner or Admin.");
  });

  it("a service waiting for IT holds Live only", () => {
    const s = launchState({ ...base, parts: [part("a", "built"), part("hubspot-lookup", "needs_approval", "hubspot")], deployments: [dep("staging", 1)] });
    expect(s.toFix).toBe(0);
    expect(s.live.blocker).toBe("Needs IT approval for HubSpot");
    expect(s.progress).toBe("waiting for IT");
    expect(s.goLive.disabledReason).toMatch(/^Needs IT approval for HubSpot/);
  });

  it("after a change (F7), the newer version is offered to the team, then to Live", () => {
    const parts = [part("a", "built")];
    const s = launchState({ ...base, currentVersion: 2, parts, deployments: [dep("staging", 1), dep("production", 1)] });
    expect(s.share).toEqual({ label: "Share v2 with your team" });
    expect(s.progress).toBe("ready to share");
    const t = launchState({ ...base, currentVersion: 2, parts, deployments: [dep("staging", 1), dep("production", 1), dep("staging", 2, "2026-10-06T11:00:00Z")] });
    expect(t.goLive).toMatchObject({ label: "Update live" });
    expect(t.live.behind).toBe(1);
    expect(t.progress).toBe("live is 1 version behind");
    expect(launchState({ ...base, currentVersion: 2, parts, deployments: [dep("staging", 2), dep("production", 2)] }).progress).toBe("Live");
  });

  it("a seeded live project with no history counts as live at its version; Viewers can't act", () => {
    const s = launchState({ ...base, role: "viewer", parts: [part("a", "built")], envLive: { staging: true, production: true } });
    expect(s).toMatchObject({ progress: "Live", team: { current: true }, live: { current: true } });
    expect(s.share.disabledReason).toBe("Viewers can't share or launch.");
  });
});

describe("without governance (review gap 1)", () => {
  const fast = { ...base, governance: false };
  it("Test → Go live in one step: the team version is optional, and a Builder goes live too", () => {
    const s = launchState({ ...fast, role: "builder", parts: [part("a", "built")] });
    expect(s).toMatchObject({ fast: true, progress: "ready to go live", goLive: { label: "Go live", request: false } });
    expect(s.goLive.disabledReason).toBeUndefined();
  });
  it("the checklist still holds it, and a service waiting for IT doesn't", () => {
    expect(launchState({ ...fast, parts: [part("a", "built"), part("b", "sample_data")] }).goLive.disabledReason).toBe("Fix 1 thing in the checklist first.");
    expect(launchState({ ...fast, parts: [part("a", "built"), part("c", "needs_approval", "hubspot")] }).live.blocker).toBeNull();
  });
});

describe("deploys that fail (review gap 9)", () => {
  it("the newest deploy failed: what failed, and the version before is still live", () => {
    const failed: Deployment = { ...dep("production", 2, "2026-10-06T12:00:00Z"), status: "failed", failure: { step: "Health check", reason: "The app didn't answer within 30 s." } };
    const s = launchState({ ...base, currentVersion: 2, parts: [part("a", "built")], deployments: [dep("staging", 2), dep("production", 1), failed] });
    expect(s.failure).toEqual({ environment: "production", version: 2, step: "Health check", reason: "The app didn't answer within 30 s." });
    expect(s.live.version).toBe(1);
    expect(s.progress).toBe("deploy failed");
    expect(s.goLive.disabledReason).toBeUndefined(); // Retry
  });
});

describe("launch settings", () => {
  it("the listing keeps today's limits; domains are plain host names; running cost per part", () => {
    expect(Listing.safeParse({ scope: "public", category: "Sales", description: "d", summary: "x".repeat(161), tags: [] }).success).toBe(false);
    expect(Listing.safeParse({ scope: "public", category: "Sales", description: "d", summary: "s", tags: Array(9).fill("t") }).success).toBe(false);
    expect(Listing.safeParse({ scope: "workspace", category: "Sales", description: "d", summary: "s", tags: ["crm"] }).success).toBe(true);
    expect(DomainName.safeParse("Prep.Acme.com").data).toBe("prep.acme.com");
    expect(DomainName.safeParse("https://prep.acme.com").success).toBe(false);
    expect(DomainName.safeParse("localhost").success).toBe(false);
    expect(runningCredits([{ status: "built", grp: "agents" }, { status: "built", grp: "integrations" }, { status: "deferred", grp: "agents" }])).toBe(16);
  });
});
