import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* M5.5 polish: two workspaces per person, and the rest of the polish list. */

test.describe("M5.5", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("polish");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });
  async function start(page: Page) {
    await signIn(page, user);
  }

  test("two workspaces: the demo first, and an empty Personal with governance off and its starting points", async ({ page }) => {
    await start(page);
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByText("Acme Ops (Enterprise)", { exact: true })).toBeVisible();
    await nav.getByRole("button", { name: /Switch workspace/ }).click();
    await page.getByRole("menuitem").filter({ hasText: "Personal" }).click();
    await page.waitForURL(/\/home$/);
    await expect(nav.getByText("Personal", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Personal workspace · governance off · go live in one step" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Help me decide" }).last()).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
    await page.goto("/home");
    await page.getByRole("button", { name: "See a team workspace → Acme Ops (Enterprise)" }).click();
    await expect(nav.getByText("Acme Ops (Enterprise)", { exact: true })).toBeVisible();
    const { data } = await adminDb().from("members").select("workspaces!inner(name, kind, governance_enabled, plan)").eq("user_id", user.id);
    expect(data!.map((m) => m.workspaces).sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { name: "Acme Ops (Enterprise)", kind: "demo", governance_enabled: true, plan: "enterprise" },
      { name: "Personal", kind: "personal", governance_enabled: false, plan: "free" },
    ]);
  });

  test("profile menu: name and email, workspaces, Settings, Theme, Help, Log out", async ({ page }) => {
    await start(page);
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await nav.getByRole("button", { name: "Profile: Polish Tester" }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toContainText(user.email);
    await expect(menu.getByRole("menuitem").filter({ hasText: "Personal" })).toBeVisible();
    await menu.getByRole("menuitem", { name: /^Theme/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await nav.getByRole("button", { name: "Profile: Polish Tester" }).click();
    await page.getByRole("menuitem", { name: /^Theme/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await nav.getByRole("button", { name: "Profile: Polish Tester" }).click();
    await page.getByRole("menuitem", { name: "Settings" }).click();
    await page.waitForURL(/\/settings$/);
    await nav.getByRole("button", { name: "Profile: Polish Tester" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
  });

  test("People: members and pending invites apart; Resend link makes a new link and the old one stops working; Revoke", async ({ page }) => {
    await start(page);
    await page.goto("/settings");
    const email = `invitee-${Date.now()}@example.com`;
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Create invite link" }).click();
    const first = await page.getByRole("status").getByLabel("Invite link").inputValue();
    const pending = page.getByRole("list", { name: "Pending invites" }).getByRole("listitem").filter({ hasText: email });
    await expect(pending).toContainText("Invited as Viewer");
    await pending.getByRole("button", { name: "Resend link" }).click();
    await expect(pending.getByRole("status")).toContainText("New link made");
    const second = await pending.getByLabel("Invite link").inputValue();
    expect(second).not.toBe(first);
    await page.goto(first);
    await expect(page.getByText("This invite link doesn't work any more")).toBeVisible();
    await page.goto("/settings");
    await page.getByRole("list", { name: "Pending invites" }).getByRole("listitem").filter({ hasText: email }).getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("list", { name: "Pending invites" }).getByText(email)).toHaveCount(0);
    const { data: audit } = await adminDb().from("audit_log").select("action").eq("target", email);
    expect(audit!.map((a) => a.action).sort()).toEqual(["member.invite_cancelled", "member.invite_resent", "member.invited"]);
  });

  test("Developer view entry: Code in the header for Builders and up; imported repos open in it; the personal setting; Delete for Owners only", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const ws = m!.workspace_id;
    const { data: vt } = await db.from("projects").select("id").eq("workspace_id", ws).eq("name", "Vendor tracker").single();
    await db.from("projects").update({ repo_full_name: "netanyaj/ticket-triage" }).eq("id", vt!.id);

    // An imported repo opens in Developer view from Projects; the others don't.
    await page.goto("/projects");
    await expect(page.getByRole("link", { name: "Vendor tracker" })).toHaveAttribute("href", `/p/${vt!.id}?dev=1`);
    await expect(page.getByRole("link", { name: "Meeting Prep" })).not.toHaveAttribute("href", /dev=1/);

    // Code in the header switches it.
    const { data: mp } = await db.from("projects").select("id").eq("workspace_id", ws).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${mp!.id}`);
    await page.getByRole("button", { name: "Developer view" }).click();
    await page.waitForURL(/dev=1/);
    await expect(page.getByText("Developer view", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Leave Developer view" }).click();
    await page.waitForURL((u) => !u.search.includes("dev=1"));

    // The personal setting: Always.
    await page.goto("/settings");
    const always = page.getByRole("group", { name: "Open projects in Developer view" }).getByRole("button", { name: "Always" });
    await always.click();
    await expect(always).toHaveAttribute("aria-pressed", "true");
    await page.goto("/projects");
    await expect(page.getByRole("link", { name: "Meeting Prep" })).toHaveAttribute("href", `/p/${mp!.id}?dev=1`);

    // Viewers: no Code, no Delete.
    await db.from("members").update({ role: "viewer" }).eq("workspace_id", ws).eq("user_id", user.id);
    try {
      await page.goto(`/p/${mp!.id}`);
      await expect(page.getByRole("navigation", { name: "Project stage" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Developer view" })).toHaveCount(0);
      await page.getByRole("button", { name: "More for this project" }).click();
      await expect(page.getByRole("menuitem", { name: "Delete project…" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    } finally {
      await db.from("members").update({ role: "owner" }).eq("workspace_id", ws).eq("user_id", user.id);
    }

    // An Owner deletes from the project's ⋯, after confirming.
    await page.goto(`/p/${vt!.id}`);
    await page.getByRole("button", { name: "More for this project" }).click();
    await page.getByRole("menuitem", { name: "Delete project…" }).click();
    const confirm = page.getByRole("dialog", { name: "Delete Vendor tracker?" });
    await confirm.getByRole("button", { name: "Keep it" }).click();
    await expect(confirm).toHaveCount(0);
    await page.getByRole("button", { name: "More for this project" }).click();
    await page.getByRole("menuitem", { name: "Delete project…" }).click();
    await confirm.getByRole("button", { name: "Delete project" }).click();
    await page.waitForURL(/\/projects$/);
    expect((await db.from("projects").select("id").eq("id", vt!.id)).data).toEqual([]);
  });
});
