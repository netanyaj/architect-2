import { expect, test, type Page } from "@playwright/test";
import { chooseDemo, signIn } from "./build.spec.seed";
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
    await expect(nav.getByText("Acme Ops (Enterprise)", { exact: true }).first()).toBeVisible();
    await nav.getByRole("button", { name: /^Account and workspace: / }).click();
    await page.getByRole("menuitem").filter({ hasText: "Personal" }).click();
    await page.waitForURL(/\/home$/);
    await expect(nav.getByText("Personal", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Personal workspace · governance off · go live in one step" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Help me decide" }).last()).toBeVisible();
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Reset demo data" })).toHaveCount(0);
    await page.goto("/home");
    await page.getByRole("button", { name: "See a team workspace → Acme Ops (Enterprise)" }).click();
    await expect(nav.getByText("Acme Ops (Enterprise)", { exact: true }).first()).toBeVisible();
    const { data } = await adminDb().from("members").select("workspaces!inner(name, kind, governance_enabled, plan)").eq("user_id", user.id);
    expect(data!.map((m) => m.workspaces).sort((a, b) => a.kind.localeCompare(b.kind))).toEqual([
      { name: "Acme Ops (Enterprise)", kind: "demo", governance_enabled: true, plan: "enterprise" },
      { name: "Personal", kind: "personal", governance_enabled: false, plan: "free" },
    ]);
  });

  test("menus: the workspace menu under the logo, the account menu from the avatar, and Architect 2.0", async ({ page }) => {
    await start(page);
    const nav = page.getByRole("navigation", { name: "Workspace" });
    await expect(nav.getByText("2.0", { exact: true })).toBeVisible();

    // M5.8: the workspace's name under the logo is plain text; the account chip and Resources sit at the foot.
    await expect(nav.getByRole("button", { name: /^Workspace: / })).toHaveCount(0);
    const chip = nav.getByRole("button", { name: "Account and workspace: Acme Ops (Enterprise)", exact: true });
    await chip.click();
    const amenu = page.getByRole("menu");
    await expect(amenu).toContainText(/Enterprise · \d+ members?/);
    await expect(amenu).toContainText(user.email);
    for (const name of ["Settings", "Invite people", "Governance", "New workspace", "Log out"]) await expect(amenu.getByRole("menuitem", { name })).toBeVisible();
    await expect(amenu.getByRole("menuitem").filter({ hasText: "Acme Ops (Enterprise)" }).getByLabel("Current")).toBeVisible();
    // No inline switches in the menu any more: Theme and the Developer view default are in Settings › Appearance.
    await expect(amenu.getByRole("radiogroup")).toHaveCount(0);
    await amenu.getByRole("menuitem", { name: "Invite people" }).click();
    const invite = page.getByRole("dialog", { name: /^Invite people to/ });
    await invite.getByLabel("Email").fill(`chip-${Date.now()}@example.com`);
    await invite.getByRole("button", { name: "Copy invite link" }).click();
    await expect(invite.getByLabel("Invite link")).toHaveValue(/\/invite\//);
    await invite.getByRole("button", { name: "Done" }).click();
    await chip.click();
    await page.getByRole("menuitem", { name: "New workspace" }).click();
    await page.getByRole("dialog", { name: "New workspace" }).getByLabel("Name").fill("Marketing");
    await page.getByRole("dialog", { name: "New workspace" }).getByRole("button", { name: "Make the workspace" }).click();
    await expect(nav.getByRole("button", { name: "Account and workspace: Marketing" })).toBeVisible();

    // Resources: Documentation, Join Discord, Keyboard shortcuts, Trash, What's new (3 + View all), Theme cycling.
    await nav.getByRole("button", { name: "Resources" }).click();
    const rmenu = page.getByRole("menu");
    for (const name of [/^Documentation/, /^Join Discord/, "Keyboard shortcuts", /^Trash( \d+)?$/, /^View all/]) await expect(rmenu.getByRole("menuitem", { name })).toBeVisible();
    const theme = rmenu.getByRole("menuitem", { name: /^Theme: / });
    await expect(theme).toHaveAttribute("title", /^Theme: /);
    const before = await page.locator("html").getAttribute("data-theme-choice");
    await theme.click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme-choice", before ?? "");
    await rmenu.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Help: one 36px button at the bottom-right, outside projects and inside them; no header "?" in a project.
    await expect(page.getByRole("button", { name: "Help", exact: true })).toBeVisible();
    const { data: mp } = await adminDb().from("projects").select("id, workspace_id").eq("name", "Meeting Prep").in("workspace_id", (await adminDb().from("members").select("workspace_id").eq("user_id", user.id)).data!.map((m) => m.workspace_id)).single();
    await chooseDemo(page, user);
    await page.goto(`/p/${mp!.id}`);
    await expect(page.getByRole("navigation", { name: "Project stage" })).toBeVisible();
    const helpButton = page.getByRole("button", { name: "Help", exact: true });
    await expect(helpButton).toBeVisible();
    expect((await helpButton.boundingBox())!.width).toBe(36);
    await expect(page.getByRole("banner").getByRole("button", { name: "Help with this project" })).toHaveCount(0);
    // The send button is never under it.
    const send = (await page.getByRole("button", { name: "Send" }).boundingBox())!;
    const help = (await helpButton.boundingBox())!;
    expect(send.y + send.height <= help.y || send.x + send.width <= help.x).toBe(true);
    await page.goto("/home");
    await nav.getByRole("button", { name: /^Account and workspace: / }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.waitForURL(/\/login/);
  });

  test("People: members and pending invites apart; Resend link makes a new link and the old one stops working; Revoke", async ({ page }) => {
    await start(page);
    await page.goto("/settings/members");
    await expect(page.getByText("Invites are shared by link", { exact: false })).toBeVisible();
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
    await page.goto("/settings/members");
    await page.getByRole("list", { name: "Pending invites" }).getByRole("listitem").filter({ hasText: email }).getByRole("button", { name: "Revoke" }).click();
    await expect(page.getByRole("list", { name: "Pending invites" }).getByText(email)).toHaveCount(0);
    const { data: audit } = await adminDb().from("audit_log").select("action").eq("target", email);
    expect(audit!.map((a) => a.action).sort()).toEqual(["member.invite_cancelled", "member.invite_resent", "member.invited"]);
  });

  test("Developer view entry: a switch in the header for Builders and up; the composer reads intent; imported repos open in it; the personal setting; Delete for Owners only", async ({ page }) => {
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

    // The composer: no mode switch (M5.8); each message is read as a question or a change.
    await page.goto(`/p/${(await db.from("projects").select("id").eq("workspace_id", ws).eq("name", "Meeting Prep").single()).data!.id}`);
    await expect(page.getByRole("radiogroup", { name: "Mode" })).toHaveCount(0);
    await expect(page.getByLabel("Message Architect")).toHaveAttribute("placeholder", "Ask a question, or describe a change…");

    // The header switch turns Developer view on and off.
    const { data: mp } = await db.from("projects").select("id").eq("workspace_id", ws).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${mp!.id}`);
    const devSwitch = page.getByRole("switch", { name: "Developer view" });
    await expect(devSwitch).toHaveAttribute("aria-checked", "false");
    await devSwitch.click();
    await page.waitForURL(/dev=1/);
    await expect(devSwitch).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("heading", { level: 1 }).getByText("Developer view")).toBeVisible();
    await devSwitch.click();
    await page.waitForURL((u) => !u.search.includes("dev=1"));

    // ⋯ › View as role › Viewer (M5.8): the page as a Viewer sees it, with the banner; Stop goes back.
    await page.getByRole("button", { name: "More for this project" }).click();
    await page.getByRole("menuitem", { name: "View as role" }).click();
    await page.getByRole("menuitem", { name: /^Viewer/ }).click();
    await page.waitForURL(/as=viewer/);
    await expect(page.getByRole("status").filter({ hasText: "Viewing as Viewer" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Developer view" })).toHaveCount(0);
    await expect(page.getByLabel("Message Architect")).toHaveAttribute("placeholder", "Ask about the plan, or suggest a change…");
    await page.getByRole("status").filter({ hasText: "Viewing as Viewer" }).getByRole("button", { name: "Stop" }).click();
    await page.waitForURL((u) => !u.search.includes("as="));
    await expect(devSwitch).toBeVisible();

    // The personal setting: Always (after the page is interactive).
    await page.goto("/settings/appearance", { waitUntil: "networkidle" });
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
      await expect(page.getByRole("switch", { name: "Developer view" })).toHaveCount(0);
      // Viewers ask, and their change requests become suggestions for a Builder.
      await expect(page.getByLabel("Message Architect")).toHaveAttribute("placeholder", "Ask about the plan, or suggest a change…");
      await page.getByLabel("Message Architect").fill("Add a Slack step that posts each brief to #sales");
      await page.getByRole("button", { name: "Send" }).click();
      const suggestion = page.getByRole("region", { name: "Suggestion" }).last();
      await expect(suggestion).toContainText("Suggested by Polish Tester");
      await expect(suggestion).toContainText("An Owner, Admin or Builder can turn it into a change.");
      await expect(suggestion.getByRole("button", { name: "Turn into a change" })).toHaveCount(0);
      await page.getByRole("button", { name: "More for this project" }).click();
      await expect(page.getByRole("menuitem", { name: "Delete project…" })).toHaveCount(0);
      await page.keyboard.press("Escape");
    } finally {
      await db.from("members").update({ role: "owner" }).eq("workspace_id", ws).eq("user_id", user.id);
    }
    // Back as the Owner: the suggestion offers "Turn into a change".
    await page.goto(`/p/${mp!.id}`);
    await expect(page.getByRole("region", { name: "Suggestion" }).last().getByRole("button", { name: "Turn into a change" })).toBeVisible();

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
    expect((await db.from("projects").select("deleted_at").eq("id", vt!.id).single()).data!.deleted_at).toBeTruthy();
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
    await page.getByRole("button", { name: "Review changes" }).click();
    const changes = page.getByRole("dialog", { name: "Changes" });
    await expect(changes.getByRole("list", { name: "Where it stands" }).locator("[aria-current=step]")).toHaveText("Draft");
    await changes.getByRole("button", { name: "Open PR" }).click();
    await expect(changes).toContainText("PR #12");
    await expect(changes.getByRole("button", { name: "Open PR" })).toHaveCount(0);

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

  test("Look and feel: a theme preset in Plan › Design is applied to the preview", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const { data: mp } = await db.from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${mp!.id}?view=plan`);
    const themes = page.getByRole("radiogroup", { name: "Theme" });
    await expect(themes.getByRole("radio", { name: /Soft Tray/ })).toHaveAttribute("aria-checked", "true");
    await themes.getByRole("radio", { name: /Graphite/ }).click();
    await expect(themes.getByRole("radio", { name: /Graphite/ })).toHaveAttribute("aria-checked", "true");
    // Picking only selects (M5.8): Apply to plan is the one action.
    await page.getByRole("button", { name: "Apply to plan" }).click();
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
      await page.getByRole("tablist", { name: "Stage view" }).getByRole("tab", { name: "Agents" }).click();
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

  test("an imported CrewAI agent: How should this agent run? Wrap as a tool, then Convert to Lyzr Studio after the estimate", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const { data: tt } = await db.from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", "ticket-triage").single();
    // As if this part's agent came from the repo in CrewAI (B-6).
    await db.from("items").update({ framework: "crewai" }).eq("project_id", tt!.id).eq("key", "urgency-and-team-label");
    await page.goto(`/p/${tt!.id}?view=agents`);
    await page.getByRole("group", { name: "How the agents connect" }).getByRole("button", { name: "Urgency and team label: open its settings" }).click();
    const settings = page.getByRole("complementary", { name: "Urgency and team label settings" });
    const choice = settings.getByRole("radiogroup", { name: "How should this agent run?" });
    await expect(choice.getByRole("radio", { name: /^Keep in CrewAI/ })).toHaveAttribute("aria-checked", "true");

    await choice.getByRole("radio", { name: /^Wrap as a tool/ }).click();
    await expect(settings.getByRole("status")).toContainText("Saved: other agents call it as a tool.");

    await choice.getByRole("radio", { name: /^Convert to a Lyzr Studio agent/ }).click();
    await expect(settings.getByText(/runs its part's check again: about 3 credits/)).toBeVisible();
    await settings.getByRole("button", { name: "Convert · ~3 credits" }).click();
    await expect(settings.getByRole("status")).toContainText(/Converted|[Ss]imulated/, { timeout: 30_000 });
    const { data: agent } = await db.from("agents").select("run_as, framework, lyzr_agent_id").eq("project_id", tt!.id).eq("item_key", "urgency-and-team-label").single();
    expect(agent).toMatchObject({ run_as: "studio", framework: "lyzr" });
    const { data: audit } = await db.from("audit_log").select("details").eq("workspace_id", m!.workspace_id).eq("action", "agent.run_changed");
    expect(audit!.map((a) => (a.details as { to: string }).to).sort()).toEqual(["studio", "tool"]);
    // Clean up the real Studio agent this made.
    if (agent!.lyzr_agent_id && process.env.LYZR_API_KEY) await fetch(`${process.env.LYZR_BASE_URL ?? "https://agent-prod.studio.lyzr.ai"}/v3/agents/${agent!.lyzr_agent_id}`, { method: "DELETE", headers: { "x-api-key": process.env.LYZR_API_KEY } }).catch(() => {});
  });

  test("Trash: a deleted project can be restored for 30 days; deleting permanently is the Owner's", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const ws = m!.workspace_id;
    await page.goto("/projects", { waitUntil: "networkidle" });
    for (const name of ["Lead scorer", "ticket-triage"]) {
      await page.getByRole("button", { name: `Actions for ${name}` }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await expect(page.getByRole("dialog")).toContainText("You can restore it from Trash for 30 days");
      await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
      await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
      // The toast: Moved to Trash · Undo · View Trash.
      await expect(page.getByRole("status").filter({ hasText: "Moved to Trash" })).toContainText("Undo");
    }
    // No "Recently deleted" link under Projects any more: Trash is its own page, from Resources.
    await expect(page.getByRole("button", { name: "Recently deleted" })).toHaveCount(0);
    await page.getByRole("link", { name: "View Trash" }).click();
    await page.waitForURL(/\/trash$/);
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    await expect(page.getByText("Projects stay here for 30 days, then they're deleted for good.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Resources" })).toBeVisible();
    const trash = page.getByRole("list", { name: "Deleted projects" });
    const lead = trash.getByRole("listitem").filter({ hasText: "Lead scorer" });
    await expect(lead).toContainText("30 days left");
    await expect(lead).toContainText("by Polish Tester");
    await lead.getByRole("button", { name: "Restore" }).click();
    await expect(lead).toHaveCount(0);
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Projects" }).click();
    await expect(page.getByRole("link", { name: "Lead scorer", exact: true })).toBeVisible();
    await page.goto("/trash");
    const tt = trash.getByRole("listitem").filter({ hasText: "ticket-triage" });
    await tt.getByRole("button", { name: "Delete permanently…" }).click();
    await tt.getByRole("button", { name: "Delete permanently" }).click();
    await expect(trash.getByText("ticket-triage")).toHaveCount(0);
    expect((await db.from("projects").select("id").eq("workspace_id", ws).eq("name", "ticket-triage")).data).toEqual([]);
    const { data: audit } = await db.from("audit_log").select("action").eq("workspace_id", ws).in("action", ["project.deleted", "project.restored", "project.deleted_forever"]).in("target", ["Lead scorer", "ticket-triage"]);
    expect(audit!.map((a) => a.action).sort()).toEqual(["project.deleted", "project.deleted", "project.deleted_forever", "project.restored"]);
  });
});
