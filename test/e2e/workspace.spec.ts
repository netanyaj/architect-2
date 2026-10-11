import { expect, test, type Page } from "@playwright/test";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

async function signIn(page: Page, user: TestUser, next = "/home") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  await page.waitForLoadState("networkidle");
}

async function workspaceOf(userId: string) {
  const { data } = await adminDb().from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", userId).eq("role", "owner").eq("workspaces.kind", "demo").single();
  return data!.workspace_id;
}

test.describe("pages and the project workspace", () => {
  // These build on each other (the owner's workspace is seeded by the first sign-in).
  test.describe.configure({ mode: "serial" });
  let owner: TestUser;
  let viewer: TestUser;

  test.beforeAll(async () => {
    [owner, viewer] = await Promise.all([createTestUser("ws-owner"), createTestUser("ws-viewer")]);
  });
  test.afterAll(async () => {
    await Promise.all([owner, viewer].filter(Boolean).map(deleteTestUser));
  });

  test("a template fills the prompt; Write the plan opens a project with the three panes and nothing built", async ({ page }) => {
    await signIn(page, owner);
    await page.getByRole("button", { name: "Templates and prompts" }).click();
    const dialog = page.getByRole("dialog", { name: "Start from something that works" });
    await dialog.getByRole("tab", { name: "Agentlets" }).click();
    await dialog.getByRole("button", { name: /Support triage/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByLabel("Describe your app")).toHaveValue(/Classify incoming Zendesk tickets/);

    await page.getByRole("button", { name: "Write the plan" }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("complementary", { name: "Plan" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Stage" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Chat" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Chat" }).getByText(/Classify incoming Zendesk tickets/)).toBeVisible();
    // Write the plan writes it straight away; before Build the stage is the plan document (screen 2).
    await expect(page.getByText(/Here's the plan: \d+ parts/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "Stage" }).getByRole("heading", { name: "What it does" }).or(page.getByRole("region", { name: "Stage" }).getByRole("heading", { name: "AI agents" })).first()).toBeVisible();
    await expect(page.getByRole("tab", { name: "Files" })).toHaveCount(0);

    // Nothing builds without a click, and only writing the plan was charged.
    const id = page.url().split("/p/")[1];
    const db = adminDb();
    expect((await db.from("runs").select("id").eq("project_id", id)).data).toEqual([]);
    expect((await db.from("usage_ledger").select("kind").eq("project_id", id)).data!.map((u) => u.kind)).toEqual(["blueprint"]);
  });

  test("Projects: filters count right, duplicate makes a draft copy, delete asks first", async ({ page }) => {
    await signIn(page, owner, "/projects");
    const filters = page.getByRole("group", { name: "Show" });
    await expect(filters.getByRole("button", { name: "Needs you 2" })).toBeVisible();
    // Meeting Prep and the Architect 1.0 app (F9), which keeps running.
    await filters.getByRole("button", { name: "Live 2" }).click();
    await expect(page.getByRole("list", { name: "Projects" }).getByRole("listitem")).toHaveCount(2);
    await filters.getByRole("button", { name: /^All/ }).click();

    await page.getByRole("button", { name: "Actions for Vendor tracker" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByRole("link", { name: "Vendor tracker copy" })).toBeVisible();

    await page.getByRole("button", { name: "Actions for Vendor tracker copy" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("link", { name: "Vendor tracker copy" })).toHaveCount(0);

    const ws = await workspaceOf(owner.id);
    await expect
      .poll(async () => (await adminDb().from("audit_log").select("action").eq("workspace_id", ws)).data!.map((l) => l.action))
      .toEqual(expect.arrayContaining(["project.duplicated", "project.deleted"]));
  });

  test("a Viewer can't click Build, and every disabled action says why", async ({ browser }) => {
    // The owner's workspace exists from the tests above; add the viewer to it.
    const ws = await workspaceOf(owner.id);
    const db = adminDb();
    await db.from("members").insert({ workspace_id: ws, user_id: viewer.id, email: viewer.email, display_name: "Test viewer", role: "viewer", status: "active" });
    const { data: draft } = await db.from("projects").select("id").eq("workspace_id", ws).eq("name", "Vendor tracker").single();

    const page = await (await browser.newContext()).newPage();
    await signIn(page, viewer);
    await page.context().addCookies([{ name: "ax_ws", value: ws, url: page.url() }]);

    await page.goto(`/p/${draft!.id}`);
    const build = page.getByRole("button", { name: /^Build · ~48 credits$/ });
    await expect(build).toHaveAttribute("aria-disabled", "true");
    await expect(build).toHaveAttribute("title", "Viewers can't build. Ask an Owner, Admin or Builder.");
    await expect(page.getByText("Viewers can't build", { exact: true })).toBeVisible();
    await build.click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/p/${draft!.id}$`)); // nothing happened
    expect((await db.from("runs").select("id").eq("project_id", draft!.id)).data).toEqual([]);

    await page.goto("/home");
    await expect(page.getByText("Viewers can't build. Ask an Owner, Admin or Builder.")).toBeVisible();

    await page.goto("/connections");
    await expect(page.getByRole("button", { name: "Connect Gmail" })).toHaveAttribute("title", "Viewers can't connect apps.");
  });
});
