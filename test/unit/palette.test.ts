import { describe, expect, it } from "vitest";
import { paletteResults } from "@/lib/palette";

/* ⌘K (M5.10): grouped results, keyboard-first, actions and pages. */

const index = {
  projects: [
    { id: "p1", name: "Meeting Prep", status: "live" },
    { id: "p2", name: "Expense checker", status: "draft" },
  ],
  agents: [{ id: "a1", name: "Research agent", projectId: "p1", projectName: "Meeting Prep" }],
  connections: [{ provider: "slack", name: "Slack", connected: true }],
  workspaces: [
    { id: "w1", label: "Acme Ops (Enterprise)", current: true },
    { id: "w2", label: "Personal", current: false },
  ],
  canBuild: true,
  admin: true,
  demoData: true,
};

describe("command palette", () => {
  it("with nothing typed: the actions first, then projects and pages", () => {
    const r = paletteResults(index, "", { projectId: null });
    expect([...new Set(r.map((i) => i.group))]).toEqual(["Actions", "Projects", "Pages"]);
    expect(r.filter((i) => i.group === "Actions").map((i) => i.label)).toEqual(["New project", "Open Trash", "View as Viewer", "Switch workspace", "Take the tour"]);
    expect(r.find((i) => i.label === "View as Viewer")).toMatchObject({ disabled: true, hint: "Open a project first" });
  });

  it("each Settings page has its own entry; Demo data only where it applies", () => {
    expect(paletteResults(index, "members", { projectId: null }).map((i) => i.href)).toContain("/settings/members");
    expect(paletteResults(index, "reset demo", { projectId: null }).map((i) => i.href)).toEqual(["/settings/demo"]);
    expect(paletteResults({ ...index, demoData: false }, "reset demo", { projectId: null })).toEqual([]);
  });

  it("Take the tour: runs in a team workspace, and says where otherwise", () => {
    expect(paletteResults(index, "tour", { projectId: null, tourAvailable: true })[0]).toMatchObject({ label: "Take the tour", tour: true });
    expect(paletteResults(index, "tour", { projectId: null, tourAvailable: false })[0]).toMatchObject({ disabled: true, hint: "In a team workspace, like Acme Ops" });
  });

  it("finds projects, agents, connections and pages by any words, grouped", () => {
    expect(paletteResults(index, "meeting", { projectId: null }).map((i) => [i.group, i.label])).toEqual([
      ["Projects", "Meeting Prep"],
      ["Agents", "Research agent"],
    ]);
    expect(paletteResults(index, "slack", { projectId: null })[0]).toMatchObject({ group: "Connections", href: "/connections" });
    expect(paletteResults(index, "audit", { projectId: null }).map((i) => i.href)).toContain("/governance?section=audit");
  });

  it("View as Viewer opens the current project as a Viewer; Switch workspace lists the others", () => {
    expect(paletteResults(index, "viewer", { projectId: "p1" })[0]).toMatchObject({ href: "/p/p1?as=viewer" });
    expect(paletteResults(index, "switch to", { projectId: null }).map((i) => i.label)).toEqual(["Switch to Personal"]);
  });

  it("Viewers get no build actions, and admin pages need an admin", () => {
    const r = paletteResults({ ...index, canBuild: false, admin: false }, "", { projectId: null });
    expect(r.some((i) => i.label === "New project" || i.label === "Open Trash" || i.label === "Governance")).toBe(false);
  });
});
