import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, connectLyzr, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* M5 follow-up (gap analysis, 11 Oct): API key connections, and the rest of the build list. One seeded workspace. */

test.describe("M5 follow-up", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  let user: TestUser;
  let workspace: string;

  test.beforeAll(async () => {
    user = await createTestUser("followup");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });
  async function start(page: Page) {
    await signIn(page, user);
    const { data: m } = await adminDb().from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    workspace = m!.workspace_id;
  }

  test("BL-9: an API key connection is Set or Not set, by whom and when; the key is never stored", async ({ page }) => {
    await start(page);
    await page.goto("/connections");
    const clearbit = page.getByRole("listitem").filter({ hasText: "Clearbit" });
    await expect(clearbit).toContainText("API key");
    await expect(clearbit).toContainText("Set by Jordan (IT)");
    await expect(clearbit).toContainText("Used by Lead scorer");

    // A service that isn't an allowed app is refused, with who can fix it.
    await page.getByRole("button", { name: "Add an API key" }).click();
    await page.getByLabel("Service").fill("Apollo");
    await page.getByLabel("API key", { exact: true }).fill("apollo-test-key");
    await page.getByRole("button", { name: "Save key" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Apollo" })).toHaveText("Apollo isn't on your organisation's allowed apps. An Owner or Admin can add it in Governance › Apps.");
    await page.getByRole("button", { name: "Cancel" }).click();

    // Replace: set by you now. Remove: Not set.
    await clearbit.getByRole("button", { name: "Replace key" }).click();
    await clearbit.getByLabel("Clearbit API key").fill("cb-test-value-123");
    await clearbit.getByRole("button", { name: "Save key" }).click();
    await expect(clearbit).toContainText(/Set by Followup Tester · (just now|\d+ min)/);
    await clearbit.getByRole("button", { name: "Remove" }).click();
    await expect(clearbit).toContainText("Not set");
    await expect(clearbit.getByRole("button", { name: "Add the key" })).toBeVisible();

    const { data: conn } = await adminDb().from("connections").select("*").eq("workspace_id", workspace).eq("provider", "clearbit").single();
    expect(JSON.stringify(conn)).not.toContain("cb-test-value-123");
    const { data: audit } = await adminDb().from("audit_log").select("action, details").eq("workspace_id", workspace).like("action", "connection.api_key%");
    expect(audit!.map((a) => a.action).sort()).toEqual(["connection.api_key_removed", "connection.api_key_replaced"]);
    expect(JSON.stringify(audit)).not.toContain("cb-test-value-123");
  });

  test("A-7: edit a built part's check; the cost shows first, then the checker runs the new check", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: p } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${p!.id}`);
    const openBriefWriter = async () => {
      const more = page.getByRole("button", { name: /^Show \d+ more$/ });
      // Wait for the parts list first: "Show N more" can appear after the first paint.
      await more.or(page.getByRole("button", { name: /^Brief writer/ })).first().waitFor();
      if (await more.isVisible()) await more.click();
      await page.getByRole("button", { name: /^Brief writer/ }).first().click();
    };
    await openBriefWriter();
    const drawer = page.getByRole("dialog", { name: "Brief writer" });
    await expect(drawer).toContainText("Written by the verifier");
    await drawer.getByRole("button", { name: "Edit the check" }).click();
    const box = drawer.getByLabel("Done when");
    await box.fill(`${await box.inputValue()} Each brief lists the attendee's open deals.`);
    await drawer.getByRole("button", { name: "See the cost" }).click();
    await expect(drawer).toContainText(/Running the new check costs ~\d+ credits/);
    const { data: before } = await db.from("usage_ledger").select("id").eq("project_id", p!.id);
    await drawer.getByRole("button", { name: /^Re-run the check · ~\d+ credits$/ }).click();

    // Charged once, on the click; the part re-runs its check (simulated, a few seconds), then works again.
    await expect.poll(async () => (await db.from("usage_ledger").select("note").eq("project_id", p!.id)).data?.map((u) => u.note), { timeout: 30_000 }).toContain("Check re-run · Brief writer");
    const { data: after } = await db.from("usage_ledger").select("id").eq("project_id", p!.id);
    expect(after!.length).toBe(before!.length + 1);
    await expect.poll(async () => (await db.from("items").select("status, status_detail").eq("project_id", p!.id).eq("key", "brief-writer").single()).data, { timeout: 30_000 }).toEqual({ status: "built", status_detail: null });
    await page.reload();
    await openBriefWriter();
    await expect(page.getByRole("dialog", { name: "Brief writer" })).toContainText("Edited by Followup Tester", { timeout: 15_000 });
    await expect(page.getByRole("dialog", { name: "Brief writer" })).toContainText("Passed the edited check against the code already built");
  });

  test("A-10: Launch says what's not done, with a reason, before any deploy; the Launch button carries the count; BL-13's checks are named", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: lead } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Lead scorer").single();
    await page.goto(`/p/${lead!.id}`);
    // The stepper holds no actions any more (M5.5 review); the Launch button opens Launch with the count.
    await expect(page.getByRole("navigation", { name: "Project stage" }).getByRole("button", { name: /Not done/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Launch · 3 to fix" }).click();
    const list = page.getByRole("list", { name: "What's not done" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(list.getByRole("listitem").first()).toContainText("Not built yet: the build paused at the budget");
    await list.getByRole("button", { name: /^Reason for each score/ }).click();
    await expect(page.getByRole("dialog", { name: "Reason for each score" })).toBeVisible();

    const { data: triage } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "ticket-triage").single();
    await page.goto(`/p/${triage!.id}/launch`);
    const notDone = page.getByRole("region", { name: "What's not done" });
    await expect(notDone).toContainText("1 part of this version doesn't work yet. A deploy ships what works.");
    await expect(notDone).toContainText("Production deploy");
    await expect(notDone).toContainText("Waiting for an Owner or Admin's approval");
    for (const check of ["Tests passed", "Security scan passed", "Personal data is hidden in logs"]) await expect(page.getByText(check, { exact: true })).toBeVisible();
  });

  test("C-10: a part calling a service with a key waits for an admin before Live; a Builder asks, an admin allows everywhere; coding agents get the same rules", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: mp } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Meeting Prep").single();
    await db.from("items").update({ provider: "clearbit" }).eq("project_id", mp!.id).eq("title", "Research agent (yours)");
    await db.from("members").update({ role: "builder" }).eq("workspace_id", workspace).eq("user_id", user.id);
    try {
      await page.goto(`/p/${mp!.id}/launch`);
      const row = page.getByRole("listitem").filter({ hasText: "Clearbit is called with a key: an Owner or Admin allows it first" });
      await expect(row).toContainText("Research agent (yours) calls Clearbit with an API key.");
      await row.getByRole("button", { name: "Ask for approval" }).click();
      await expect(page.getByText("Asked. An Owner or Admin decides in Approvals.")).toBeVisible();
      await expect(row).toContainText("Waiting for an Owner or Admin");
    } finally {
      await db.from("members").update({ role: "owner" }).eq("workspace_id", workspace).eq("user_id", user.id);
    }

    await page.goto("/governance/approvals");
    const requests = page.getByRole("region", { name: "Requests" });
    const detail = page.getByRole("region", { name: "Request", exact: true });
    await requests.getByRole("button", { name: /Let Meeting Prep call Clearbit with a key/ }).click();
    await expect(detail).toContainText("External call · rule: calls to outside services with a key need an admin");
    await detail.getByLabel(/^Reason/).fill("Company data only, read only");
    await detail.getByRole("button", { name: "Approve and allow everywhere" }).click();
    await requests.getByRole("button", { name: "Rules" }).click();
    await expect(requests.getByRole("button", { name: /Clearbit can be called with a key in every project/ })).toBeVisible();
    await page.goto(`/p/${mp!.id}/launch`);
    await expect(page.getByText("Clearbit is called with a key")).toHaveCount(0);

    // The rule is listed with the others in Governance, and the coding-agent docs list every rule.
    await page.goto("/governance?section=rules");
    await expect(page.getByText("External calls with a key", { exact: true })).toBeVisible();
    await page.goto("/docs/mcp");
    await expect(page.getByText(/External calls with a key: calls with a key on Live need an Owner or Admin's OK/)).toBeVisible();
  });

  test("BL-2: attach a Lyzr Studio agent in the composer; the plan is asked to use it as a part", async ({ page }) => {
    await start(page);
    // The workspace's own Studio (M5.10): its agents are listed with its own key.
    await connectLyzr(workspace, user);
    await page.goto("/home");
    await page.getByRole("button", { name: "Add files, agents or tools" }).click();
    await page.getByRole("menuitem", { name: /Attach a Lyzr Studio agent/ }).click();
    const dialog = page.getByRole("dialog", { name: "Attach a Lyzr Studio agent" });
    const first = dialog.getByRole("list", { name: "Studio agents" }).getByRole("listitem").first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    const name = (await first.locator("span.font-semibold").first().textContent())!.trim();
    await first.getByRole("button", { name: "Attach" }).click();
    await expect(page.getByText(`${name} Lyzr Studio agent`)).toBeVisible();
    await page.getByLabel("Describe your app").fill("Every morning, research each new lead's company and post a short summary to #sales.");
    await page.getByRole("button", { name: /^Write the plan/ }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}/, { timeout: 60_000 });
    const id = page.url().split("/p/")[1].split("?")[0];
    const { data: p } = await adminDb().from("projects").select("prompt").eq("id", id).single();
    expect(p!.prompt).toContain(`Use my existing Lyzr Studio agent “${name}”`);
  });

  test("Plans: the seeded workspace is on Enterprise; on Free the badge stays, on a paid plan it can be hidden", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: mp } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Meeting Prep").single();
    await page.goto("/settings#plan");
    const plans = page.getByRole("list", { name: "Plans" });
    const custom = plans.getByRole("listitem").filter({ hasText: "Let's talk" });
    await expect(custom).toContainText("Your plan");
    await expect(custom).toContainText("Runs in Lyzr Cloud or your own AWS VPC");
    // Today's Architect plans: prices monthly or yearly, credits, the watermark and priority support, "Soon" items.
    const starter = plans.getByRole("listitem").filter({ hasText: "$20 a month" });
    await expect(starter).toContainText("$20 a month");
    await expect(starter).toContainText("No “Built with Architect” watermark");
    await expect(starter).toContainText("Priority support");
    await expect(starter).toContainText("SoonCustom agent branding");
    await page.getByRole("group", { name: "Billing" }).getByRole("button", { name: "Yearly" }).click();
    await expect(plans.getByRole("listitem").filter({ hasText: "$17 a month, billed yearly" })).toContainText("Saves $40 a year");
    await expect(plans.getByRole("listitem").filter({ hasText: "$35 a month" })).toContainText("Popular");
    // A top-up (simulated) adds to this month's allowance.
    const { data: before } = await db.from("workspaces").select("credits_total").eq("id", workspace).single();
    await page.getByRole("button", { name: "500 credits · $5" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added 500 credits." })).toBeVisible();
    expect((await db.from("workspaces").select("credits_total").eq("id", workspace).single()).data!.credits_total).toBe(Number(before!.credits_total) + 500);
    await plans.getByRole("button", { name: "Switch to Free" }).click();
    await expect(plans.getByRole("listitem").filter({ hasText: "Free credits to start" })).toContainText("Your plan");

    await page.goto(`/p/${mp!.id}/launch`);
    const badge = page.getByRole("switch", { name: "Show “Built with Architect”" });
    await expect(badge).toHaveAttribute("aria-checked", "true");
    await expect(badge).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("The Free plan always shows it. Starter and up can hide it, in Settings › Plan.").first()).toBeVisible();

    await page.goto("/settings#plan");
    await plans.getByRole("button", { name: "Switch to Pro" }).click();
    await expect(plans.getByRole("listitem").filter({ hasText: "$40 of credits a month" })).toContainText("Your plan");
    await page.goto(`/p/${mp!.id}/launch`);
    await badge.click();
    // The switch flips at once; the save follows.
    await expect(badge).toHaveAttribute("aria-checked", "false");
    await expect.poll(async () => ((await db.from("projects").select("launch_settings").eq("id", mp!.id).single()).data!.launch_settings as { badge?: boolean }).badge).toBe(false);
  });

  test("Drift 1: approving an app also allows its data host, ticked by default; Lead scorer's egress hold clears", async ({ page }) => {
    await start(page);
    const db = adminDb();
    await page.goto("/governance?section=egress");
    await expect(page.getByRole("region", { name: "Policies", exact: true }).getByRole("button", { name: /Data and egress.*1 project held/ })).toBeVisible();

    await page.goto("/governance/approvals");
    const requests = page.getByRole("region", { name: "Requests" });
    const detail = page.getByRole("region", { name: "Request", exact: true });
    await requests.getByRole("button", { name: /Allow HubSpot in the workspace/ }).click();
    const box = detail.getByRole("checkbox", { name: /Also allow api\.hubapi\.com for data/ });
    await expect(box).toBeChecked();
    await detail.getByLabel(/^Reason/).fill("Sales needs it");
    await detail.getByRole("button", { name: "Approve and allow everywhere" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Approved" }).first()).toBeVisible();

    const { data: egress } = await db.from("policies").select("config").eq("workspace_id", workspace).eq("kind", "egress").single();
    expect((egress!.config as { hosts: string[] }).hosts).toContain("api.hubapi.com");
    await page.goto("/governance?section=egress");
    await expect(page.getByRole("region", { name: "Policies", exact: true }).getByRole("button", { name: /Data and egress/ })).not.toContainText("held");
  });

  test("Drift 4: ?sim=byoagent writes the coding agent's steps to the audit log, under Coding agent, marked simulated", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: mp } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Meeting Prep").single();
    await db.from("project_tokens").insert({ project_id: mp!.id, name: "Claude Code", scopes: ["read_plan", "change_parts", "run"], token_hash: `e2e-${Date.now()}`, last4: "e2e0", status: "active", created_by: user.id });
    await page.goto(`/p/${mp!.id}?sim=byoagent`);
    await expect(page.getByRole("region", { name: "Coding agent session" })).toContainText("tried to set a key for Live · refused", { timeout: 20_000 });
    await expect.poll(async () => (await db.from("audit_log").select("action").eq("workspace_id", workspace).like("action", "coding_agent.%")).data?.length ?? 0, { timeout: 20_000 }).toBeGreaterThan(4);

    await page.goto("/governance?section=audit");
    const policy = page.getByRole("region", { name: "Policy", exact: true });
    await policy.getByRole("group", { name: "Done by" }).getByRole("button", { name: "Coding agent" }).click();
    const list = policy.getByRole("list", { name: "Audit entries" });
    await expect(list).toContainText("A coding agent was refused");
    await expect(list).toContainText("Coding agent: Claude Code (you)");
  });

  test("Plan-stage mockup: before Build, Mockup shows the preview shell and Workflow the agents graph; nothing is built", async ({ page }) => {
    await start(page);
    const db = adminDb();
    const { data: vt } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "Meeting Prep").single();
    // A draft copy of a plan with agents: Duplicate makes one without building anything.
    await page.goto(`/p/${vt!.id}`);
    await page.getByRole("button", { name: "More for this project" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await page.waitForURL((u) => /\/p\/[0-9a-f-]{36}/.test(u.pathname) && !u.pathname.includes(vt!.id), { timeout: 30_000 });
    const views = page.getByRole("tablist", { name: "Stage view" });
    await expect(views.getByRole("tab", { name: "Plan" })).toHaveAttribute("aria-selected", "true");
    await views.getByRole("tab", { name: "App" }).click();
    await expect(page.getByText("A mockup from the plan: nothing is built yet.")).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "/private/tmp/claude-501/-Users-netanyajaison-Desktop-Lock-innn-projects-Lyzr-handoff/b1b50ffc-1030-4cbe-b3d4-3878084915ad/scratchpad/mockup.png" });
    await views.getByRole("tab", { name: "Agents" }).click();
    await expect(page.getByText("The plan's agents and how they connect: nothing is built yet.")).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "/private/tmp/claude-501/-Users-netanyajaison-Desktop-Lock-innn-projects-Lyzr-handoff/b1b50ffc-1030-4cbe-b3d4-3878084915ad/scratchpad/workflow.png" });
    await expect(page.getByRole("button", { name: /^Build · ~\d+ credits$/ })).toBeVisible();
    const id = page.url().split("/p/")[1].split("?")[0];
    const { data: runs } = await db.from("runs").select("id").eq("project_id", id);
    expect(runs).toEqual([]);
  });

  test("Files: a PDF becomes a knowledge base and a CSV a data analyst in the plan (simulated)", async ({ page }) => {
    await start(page);
    await page.goto("/home", { waitUntil: "networkidle" });
    await page.getByLabel("Add files: PDFs, CSV or Excel files, or images").setInputFiles(["test/fixtures/files/q3-pricing-sheet.pdf", "test/fixtures/files/renewals-2026.csv"]);
    await expect(page.getByText("q3-pricing-sheet.pdf")).toBeVisible();
    await page.getByLabel("Describe your app").fill("Every Monday, post to #ops which vendors renew this month, with their owner and cost.");
    await page.getByRole("button", { name: /^Write the plan/ }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}/, { timeout: 90_000 });
    await expect(page.getByRole("button", { name: /^Build · ~\d+ credits$/ })).toBeVisible({ timeout: 120_000 });
    const id = page.url().split("/p/")[1].split("?")[0];
    const { data: bp } = await adminDb().from("blueprints").select("id").eq("project_id", id).single();
    const { data: items } = await adminDb().from("items").select("key, title, grp, source_quote").eq("blueprint_id", bp!.id);
    // Either the plan used each file itself, or Architect added the part for it.
    const uses = (name: string) => items!.some((i) => `${i.title} ${i.source_quote}`.toLowerCase().includes(name));
    expect(uses("q3-pricing-sheet") || uses("pricing")).toBe(true);
    expect(items!.some((i) => i.grp === "agents" && /renewals-2026|data analyst/i.test(i.title)) || uses("renewals-2026")).toBe(true);
    if (items!.some((i) => i.key === "knowledge-q3-pricing-sheet")) await expect(page.getByText("From your file: q3-pricing-sheet.pdf")).toBeVisible();
  });
});
