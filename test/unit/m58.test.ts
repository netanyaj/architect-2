import { describe, expect, it, vi } from "vitest";
import { isSignInService, WAITING_FOR_KEY } from "@/lib/providers";
import { hasDarkTheme, previewVars } from "@/lib/themes";

vi.mock("@/server/db", () => ({ createAdminDb: () => ({}), createServerDb: async () => ({}) }));
const { viewingAs } = await import("@/server/project");

/* M5.8: View as role, keys vs sign-in, the preview's Dark view. */
describe("View as role", () => {
  const project = { role: "owner" } as Parameters<typeof viewingAs>[0];
  it("shows a lower role and remembers the real one", () => {
    expect(viewingAs(project, "viewer")).toMatchObject({ role: "viewer", viewingAs: { role: "viewer", real: "owner" } });
    expect(viewingAs(project, "builder")).toMatchObject({ role: "builder", viewingAs: { role: "builder", real: "owner" } });
  });
  it("ignores anything else, and never raises a role", () => {
    expect(viewingAs(project, "admin")).toBe(project);
    expect(viewingAs(project, undefined)).toBe(project);
    const viewer = { role: "viewer" } as Parameters<typeof viewingAs>[0];
    expect(viewingAs(viewer, "builder")).toBe(viewer);
  });
});

describe("Action needed: keys", () => {
  it("tells services you sign in to from services that take an API key", () => {
    expect(isSignInService("slack")).toBe(true);
    expect(isSignInService("clearbit")).toBe(false);
    expect(isSignInService(null)).toBe(false);
    expect(WAITING_FOR_KEY).toBe("Waiting for a key");
  });
});

describe("The preview's Dark view", () => {
  it("knows whether the plan has a dark theme", () => {
    expect(hasDarkTheme("soft", [{ key: "brief", title: "Brief" }])).toBe(false);
    expect(hasDarkTheme("soft", [{ key: "dark-theme", title: "Dark theme" }])).toBe(true);
    expect(hasDarkTheme("soft", [{ key: "x", title: "Theme", description: "Adds a dark mode switch" }])).toBe(true);
    expect(hasDarkTheme("soft", [{ key: "dark-theme", title: "Dark theme", status: "dropped" }])).toBe(false);
    expect(hasDarkTheme("graphite", [])).toBe(true);
  });
  it("uses each preset's dark counterpart, keeping its font and corners", () => {
    const light = previewVars("editorial", "light");
    const dark = previewVars("editorial", "dark");
    expect(dark.bg).not.toBe(light.bg);
    expect(dark.font).toBe(light.font);
    expect(dark.radius).toBe(light.radius);
  });
});
