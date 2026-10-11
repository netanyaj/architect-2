import { expect, test, type Page } from "@playwright/test";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

async function signIn(page: Page, user: TestUser, next = "/home") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("roles and invites", () => {
  let owner: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;

  test.beforeAll(async () => {
    [owner, viewer, stranger] = await Promise.all([createTestUser("owner"), createTestUser("viewer"), createTestUser("stranger")]);
  });
  test.afterAll(async () => {
    await Promise.all([owner, viewer, stranger].filter(Boolean).map(deleteTestUser));
  });

  test("an Owner invites a Viewer by link; the Viewer joins with read-only rights", async ({ browser }) => {
    // Owner: invite as Viewer from Settings.
    const ownerPage = await (await browser.newContext()).newPage();
    await signIn(ownerPage, owner, "/settings");
    await expect(ownerPage.getByRole("heading", { name: "People in Acme Ops (Enterprise)" })).toBeVisible();
    // The seeded teammates are pending invites, apart from the members.
    await expect(ownerPage.getByRole("list", { name: "Pending invites" }).getByText("Jordan (IT)", { exact: true })).toBeVisible();
    await expect(ownerPage.getByRole("list", { name: "Members" }).getByText("Jordan (IT)", { exact: true })).toHaveCount(0);

    await ownerPage.getByLabel("Email", { exact: true }).fill(viewer.email);
    await ownerPage.getByLabel("Role", { exact: true }).selectOption("viewer");
    await ownerPage.getByRole("button", { name: "Create invite link" }).click();
    const linkField = ownerPage.getByRole("status").getByLabel("Invite link");
    await expect(linkField).toHaveValue(/\/invite\/[0-9a-f-]{36}$/);
    const link = await linkField.inputValue();

    // Someone else can't use the link.
    const strangerPage = await (await browser.newContext()).newPage();
    await signIn(strangerPage, stranger);
    await strangerPage.goto(link);
    await expect(strangerPage.getByRole("alert").filter({ hasText: /\S/ })).toContainText(`This invite only works for ${viewer.email}`);
    await expect(strangerPage.getByRole("button", { name: "Accept and join" })).toHaveCount(0);

    // Viewer: signed out → sign in from the invite → accept.
    const viewerPage = await (await browser.newContext()).newPage();
    await viewerPage.goto(link);
    await expect(viewerPage.getByRole("heading", { name: "Join Acme Ops (Enterprise) · Owner's" })).toBeVisible();
    await expect(viewerPage.getByText(/invited .* as Viewer/)).toBeVisible();
    await viewerPage.getByRole("link", { name: "Sign in to accept" }).click();
    await viewerPage.getByLabel("Email").fill(viewer.email);
    await viewerPage.getByLabel("Password").fill(viewer.password);
    await viewerPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await viewerPage.waitForURL(/\/invite\//);
    await viewerPage.getByRole("button", { name: "Accept and join" }).click();
    await viewerPage.waitForURL(/\/home$/);

    // They're now in the Owner's workspace, as Viewer, and can switch back to their own.
    const nav = viewerPage.getByRole("navigation", { name: "Workspace" });
    // Everyone's demo has the same name, so someone else's shows its owner (0021).
    // The account chip names it; its menu tags the role where you aren't the Owner (M5.8).
    const chip = nav.getByRole("button", { name: "Account and workspace: Acme Ops (Enterprise) · Owner's" });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(viewerPage.getByRole("menuitem").filter({ hasText: "· Owner's" })).toContainText("Viewer");
    await viewerPage.keyboard.press("Escape");
    await expect(nav.getByRole("link", { name: "Approvals" })).toHaveCount(0); // admin-only section hidden

    await viewerPage.goto("/settings");
    await expect(viewerPage.getByText("Only Owners and Admins can invite people or change roles.")).toBeVisible();
    await expect(viewerPage.getByRole("button", { name: "Create invite link" })).toHaveCount(0);
    await expect(viewerPage.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);

    await nav.getByRole("button", { name: /^Account and workspace: / }).click();
    await viewerPage.getByRole("menuitem").filter({ hasText: "Acme Ops (Enterprise)" }).filter({ hasNotText: "·" }).click();
    await viewerPage.waitForURL(/\/home$/);
    // Their own: no role tag on the chip's name, and Approvals is back (they're its Owner).
    await expect(nav.getByRole("button", { name: "Account and workspace: Acme Ops (Enterprise)", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Approvals" })).toBeVisible();

    // The database agrees, and the join was audited.
    const db = adminDb();
    const { data: ownerWs } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", owner.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const { data: joined } = await db.from("members").select("role, status, invite_token").eq("workspace_id", ownerWs!.workspace_id).eq("user_id", viewer.id).single();
    expect(joined).toEqual({ role: "viewer", status: "active", invite_token: null });
    const { data: log } = await db.from("audit_log").select("action").eq("workspace_id", ownerWs!.workspace_id);
    expect(log!.map((l) => l.action)).toEqual(expect.arrayContaining(["member.invited", "member.joined"]));

    // The used link no longer works.
    await strangerPage.goto(link);
    await expect(strangerPage.getByRole("heading", { name: "This invite link doesn't work any more" })).toBeVisible();

    // Owner changes the Viewer to Builder; it's audited.
    await ownerPage.reload();
    await ownerPage.getByLabel(/^Role for Viewer Tester$/).selectOption("builder");
    await expect.poll(async () => (await db.from("members").select("role").eq("workspace_id", ownerWs!.workspace_id).eq("user_id", viewer.id).single()).data?.role).toBe("builder");
    // The audit row is written just after the role; wait for it.
    await expect
      .poll(async () => (await db.from("audit_log").select("details").eq("workspace_id", ownerWs!.workspace_id).eq("action", "member.role_changed").maybeSingle()).data?.details)
      .toEqual({ from: "viewer", to: "builder" });
  });
});
