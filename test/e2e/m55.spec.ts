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

    // The personal setting: Always (after the page is interactive).
    await page.goto("/settings", { waitUntil: "networkidle" });
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

  test("Developer view terminal: real-mapped commands, the sandbox line for the rest, audited; none for Viewers; Open PR", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const ws = m!.workspace_id;
    const { data: mp } = await db.from("projects").select("id").eq("workspace_id", ws).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${mp!.id}?dev=1&view=terminal`);
    const term = page.getByRole("log", { name: "Terminal" });
    const type = async (cmd: string) => {
      await page.getByLabel("Command").fill(cmd);
      await page.getByLabel("Command").press("Enter");
    };
    await type("npm test");
    await expect(term).toContainText("PASS  Brief writer", { timeout: 30_000 });
    await expect(term).toContainText(/\d+ passed/);
    await type("ls");
    await expect(term).toContainText("agents/");
    await type("cat README.md");
    await expect(term).toContainText("# Meeting Prep");
    await type("git status");
    await expect(term).toContainText("On branch architect/plan-v1");
    await type("curl https://example.com");
    await expect(term).toContainText("Runs in your project's sandbox in Architect 2.0");
    const { data: audit } = await db.from("audit_log").select("target").eq("workspace_id", ws).eq("action", "terminal.command");
    expect(audit!.map((a) => a.target)).toEqual(expect.arrayContaining(["Meeting Prep: npm test", "Meeting Prep: curl https://example.com"]));

    // A repo project: Open PR (Simulated).
    await db.from("projects").update({ repo_full_name: "netanyaj/ticket-triage" }).eq("id", mp!.id);
    await page.goto(`/p/${mp!.id}?dev=1`);
    await page.getByRole("button", { name: "Open PR" }).click();
    await expect(page.getByText(/PR #12/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open PR" })).toHaveAttribute("aria-disabled", "true");

    // Viewers: no terminal.
    await db.from("members").update({ role: "viewer" }).eq("workspace_id", ws).eq("user_id", user.id);
    try {
      await page.goto(`/p/${mp!.id}?dev=1&view=terminal`);
      await expect(page.getByRole("tab", { name: "Code" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "Terminal" })).toHaveCount(0);
      await expect(page.getByLabel("Command")).toHaveCount(0);
    } finally {
      await db.from("members").update({ role: "owner" }).eq("workspace_id", ws).eq("user_id", user.id);
    }
  });

  test("uploaded data: a CSV and an Excel file become the Test version's data, From your file; the rest is Sample data", async ({ page }) => {
    await start(page);
    await page.goto("/home", { waitUntil: "networkidle" });
    await page.getByLabel("Add files: PDFs, CSV or Excel files, or images").setInputFiles(["test/fixtures/files/renewals-2026.csv", "test/fixtures/files/accounts-q4.xlsx"]);
    // Both attached before writing the plan (a file chosen before the page is interactive isn't kept).
    await expect(page.getByText("renewals-2026.csv")).toBeVisible();
    await expect(page.getByText("accounts-q4.xlsx")).toBeVisible();
    await page.getByLabel("Describe your app").fill("Every Monday, post to #ops which vendors renew this month, with their owner and cost.");
    await page.getByRole("button", { name: /^Write the plan/ }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}/, { timeout: 90_000 });
    const id = page.url().split("/p/")[1].split("?")[0];
    await page.goto(`/p/${id}?view=data`);
    const tables = page.getByRole("navigation", { name: "Tables" });
    await expect(tables.getByRole("button", { name: /renewals-2026/ })).toContainText("From your file · 3 rows");
    await tables.getByRole("button", { name: /accounts-q4/ }).click();
    const table = page.getByRole("region", { name: "accounts-q4" });
    await expect(table).toContainText("From your file");
    await expect(table).toContainText("Northwind");
    await expect(table).toContainText("42000");
    const { data: files } = await adminDb().from("files").select("name, mime").eq("project_id", id);
    expect(files!.map((f) => f.name).sort()).toEqual(["accounts-q4.xlsx", "renewals-2026.csv"]);
  });

  test("Look and feel: a theme preset in Files is applied to the preview", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const { data: mp } = await db.from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${mp!.id}?view=files`);
    const themes = page.getByRole("radiogroup", { name: "Theme" });
    await expect(themes.getByRole("radio", { name: /Soft Tray/ })).toHaveAttribute("aria-checked", "true");
    await themes.getByRole("radio", { name: /Graphite/ }).click();
    await expect(themes.getByRole("radio", { name: /Graphite/ })).toHaveAttribute("aria-checked", "true");
    await expect.poll(async () => ((await db.from("projects").select("launch_settings").eq("id", mp!.id).single()).data!.launch_settings as { look?: string }).look).toBe("graphite");
    await page.getByRole("tablist", { name: "Stage view" }).getByRole("tab", { name: "App" }).click();
    const frame = page.frameLocator("iframe[title='Meeting Prep, test version']");
    await expect(frame.locator("html")).toHaveAttribute("data-theme", "graphite", { timeout: 15_000 });
    expect(await frame.locator("body").evaluate((b) => getComputedStyle(b).backgroundColor)).toBe("rgb(21, 23, 27)");
  });

  for (const prompt of ["An invoice generator for a shipping company", "An internal sales dashboard"]) {
    test(`plans without agents: the Agents tab says so, or shows the agents ("${prompt}")`, async ({ page }) => {
      await start(page);
      await page.goto("/home", { waitUntil: "networkidle" });
      await page.getByLabel("Describe your app").fill(prompt);
      await page.getByRole("button", { name: /^Write the plan/ }).click();
      await page.waitForURL(/\/p\/[0-9a-f-]{36}/, { timeout: 90_000 });
      await expect(page.getByRole("button", { name: /^Build · ~\d+ credits$/ })).toBeVisible({ timeout: 120_000 });
      const id = page.url().split("/p/")[1].split("?")[0];
      const { data: bp } = await adminDb().from("blueprints").select("id").eq("project_id", id).order("version", { ascending: false }).limit(1).single();
      const { data: items } = await adminDb().from("items").select("grp").eq("blueprint_id", bp!.id);
      const agents = items!.filter((i) => i.grp === "agents").length;
      await page.getByRole("tablist", { name: "Stage view" }).getByRole("tab", { name: "Workflow" }).click();
      if (agents === 0) {
        await expect(page.getByRole("heading", { name: "No agents in this plan" })).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("button", { name: "Ask for an agent" })).toBeVisible();
      } else {
        await expect(page.getByText(/AI agent · new/).first()).toBeVisible({ timeout: 30_000 });
      }
      console.log(`"${prompt}": ${items!.length} parts, ${agents} agents`);
    });
  }

  test("the daily plan limit: past it, the plan says so plainly, with nothing to retry", async ({ page }) => {
    const limited = await createTestUser("limited");
    try {
      await signIn(page, limited);
      const db = adminDb();
      const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", limited.id).eq("role", "owner").eq("workspaces.kind", "personal").single();
      const { data: p } = await db.from("projects").insert({ workspace_id: m!.workspace_id, name: "Filler", owner_id: limited.id, status: "draft", model: "gemini", prompt: "x" }).select("id").single();
      await db.from("blueprints").insert(Array.from({ length: 20 }, (_, i) => ({ project_id: p!.id, version: i + 1, prompt: "x", created_by: limited.id, generation: "ready" })));
      await page.goto("/home", { waitUntil: "networkidle" });
      await page.getByLabel("Describe your app").fill("An internal sales dashboard");
      await page.getByRole("button", { name: /^Write the plan/ }).click();
      await page.waitForURL(/\/p\/[0-9a-f-]{36}/, { timeout: 60_000 });
      await expect(page.getByRole("heading", { name: "Today's plans are used up" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/You've written 20 plans today/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    } finally {
      await deleteTestUser(limited);
    }
  });
});
