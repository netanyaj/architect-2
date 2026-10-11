import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Task 4 of the governance layer: Keys and passwords (a missing Live key holds Go live; a Builder's Live key waits for
   an admin; the value is never stored), Take offline and Go live again, permission rules (C-10), the org budget
   (C-7: stopped at 100%, ask to raise, approved) and the audit log (C-6: filters and CSV). */

const policy = (page: Page) => page.getByRole("region", { name: "Policy", exact: true });
const policies = (page: Page) => page.getByRole("region", { name: "Policies", exact: true });

test.describe("Rules, budgets, keys and the audit log", () => {
  test.setTimeout(200_000);
  let user: TestUser;
  let workspace: string;

  test.beforeAll(async () => {
    user = await createTestUser("rules");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });
  async function signInAndFind(page: Page) {
    await signIn(page, user);
    const { data: m } = await adminDb().from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    workspace = m!.workspace_id;
  }
  const setRole = (role: "owner" | "builder") => adminDb().from("members").update({ role }).eq("workspace_id", workspace).eq("user_id", user.id);

  test("keys: a key missing for Live holds Go live; a Builder's Live key waits for an admin; the value is never kept", async ({ page }) => {
    await signInAndFind(page);
    const db = adminDb();
    const id = await seedPlan(user, "Partner sync");
    await db.from("blueprints").update({ agreed_at: new Date().toISOString(), status: "agreed" }).eq("project_id", id);
    await db.from("items").update({ status: "built" }).eq("project_id", id);
    await db.from("projects").update({ status: "built" }).eq("id", id);
    // An imported repo's .env.example names a key nothing provides.
    await db.from("repo_imports").insert({ project_id: id, workspace_id: workspace, full_name: "acme/partner-sync", analysis: { analysis: { keys: [{ name: "PARTNER_API_KEY", service: null, lyzrInstead: false }] }, behaviour: [], behaviourError: null } });

    await page.goto(`/p/${id}/launch`);
    const row = page.getByRole("listitem").filter({ hasText: "1 key isn't set for Live" });
    await expect(row).toContainText("PARTNER_API_KEY. Live can't run without it.");
    // It holds Live, not the team version.
    await expect(page.getByRole("button", { name: "Share with your team" })).not.toHaveAttribute("aria-disabled", "true");

    await setRole("builder");
    try {
      await page.reload();
      await row.getByRole("button", { name: "Set keys" }).click();
      const dialog = page.getByRole("dialog", { name: "Keys and passwords" });
      const key = dialog.getByRole("listitem").filter({ hasText: "PARTNER_API_KEY" });
      await key.getByRole("button", { name: "Set" }).last().click();
      await dialog.getByLabel("Value of PARTNER_API_KEY for Live").fill("pk_live_do_not_store");
      await expect(dialog).toContainText("Your organisation's rule: a key for Live waits for an Owner or Admin.");
      await dialog.getByRole("button", { name: "Ask an admin" }).click();
      await expect(dialog.getByRole("status")).toContainText("PARTNER_API_KEY for Live is waiting for an Owner or Admin.");
      await expect(key).toContainText("Waiting for an admin");
    } finally {
      await setRole("owner");
    }
    const { data: rows } = await db.from("project_keys").select("*").eq("project_id", id);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("pk_live_do_not_store");

    // The Owner approves it in Approvals; the Live row clears.
    await page.goto("/governance/approvals");
    await page.getByRole("region", { name: "Requests", exact: true }).getByRole("button", { name: /Set PARTNER_API_KEY for Live in Partner sync/ }).click();
    await page.getByRole("region", { name: "Request", exact: true }).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("region", { name: "Request", exact: true }).getByRole("status")).toContainText("Approved.");
    await page.goto(`/p/${id}/launch`);
    await expect(page.getByRole("listitem").filter({ hasText: "isn't set for Live" })).toHaveCount(0);
    const { data: audit } = await db.from("audit_log").select("action, details").eq("workspace_id", workspace).in("action", ["key.requested", "approval.approved"]);
    expect(audit!.map((a) => a.action).sort()).toEqual(["approval.approved", "key.requested"]);
    expect(JSON.stringify(audit)).not.toContain("pk_live_do_not_store");
  });

  test("Take offline keeps v1 and its data; Go live again brings it back", async ({ page }) => {
    await signInAndFind(page);
    const { data: p } = await adminDb().from("projects").select("id").eq("workspace_id", workspace).eq("name", "Meeting Prep").single();
    await page.goto(`/p/${p!.id}/launch`);
    await page.getByRole("button", { name: "Take offline" }).click();
    await page.getByRole("dialog", { name: "Take Meeting Prep offline?" }).getByRole("button", { name: "Take offline" }).click();
    await expect(page.getByText(/Offline · v\d+ kept/)).toBeVisible();
    await page.getByRole("button", { name: /^Go live again with v\d+$/ }).click();
    await page.getByRole("dialog", { name: /^Bring back v\d+ on Live\?$/ }).getByRole("button", { name: /^Go live with v\d+$/ }).click();
    await expect(page.getByRole("heading", { name: /^v\d+ is live$/ })).toBeVisible();
  });

  test("rules, the monthly cap (stopped, asked to raise, approved) and the audit log with CSV", async ({ page }) => {
    await signInAndFind(page);
    // Permission rules: Live deploys no longer need an admin.
    await page.goto("/governance?section=rules");
    await policy(page).getByRole("switch", { name: "Live deploys" }).click();
    await policy(page).getByRole("button", { name: "Save rules" }).click();
    await expect(policy(page).getByRole("status")).toContainText("Saved.");
    await expect(policies(page).getByRole("button", { name: /Permission rules/ })).toContainText("Needs approval: pushes to main, keys and passwords for live");

    // A 10-credit cap: the seeded demo already spent more, so paid actions stop.
    await page.goto("/governance?section=budgets");
    await policy(page).getByLabel(/^Monthly cap for the organisation/).fill("10");
    await policy(page).getByRole("button", { name: "Save budgets" }).click();
    await expect(policy(page).getByRole("status").first()).toContainText("Saved.");
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Paid actions are stopped" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Raise the cap" })).toBeVisible();

    // A Builder asks to raise it; the Build button says why it's off.
    await setRole("builder");
    try {
      const { data: v } = await adminDb().from("projects").select("id").eq("workspace_id", workspace).eq("name", "Vendor tracker").single();
      await page.goto(`/p/${v!.id}`);
      await expect(page.locator('header [title^="Your organisation has used its monthly credit cap"]')).toBeVisible();
      await page.getByRole("button", { name: "Ask to raise the cap" }).click();
      await page.getByLabel("New monthly cap (credits)").fill("5000");
      await page.getByRole("button", { name: "Send the request" }).click();
      await expect(page.getByText("Your request to raise the cap is waiting for an Owner or Admin.")).toBeVisible();
    } finally {
      await setRole("owner");
    }
    await page.goto("/governance/approvals");
    await page.getByRole("region", { name: "Requests", exact: true }).getByRole("button", { name: /Raise the monthly cap to 5,000 credits/ }).click();
    await page.getByRole("region", { name: "Request", exact: true }).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("region", { name: "Request", exact: true }).getByRole("status")).toContainText("Approved.");
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "Paid actions are stopped" })).toHaveCount(0);

    // The audit log: everything above, filterable, and exported as CSV.
    await page.goto("/governance?section=audit");
    await policy(page).getByLabel("Search").fill("cap");
    const list = policy(page).getByRole("list", { name: "Audit entries" });
    await expect(list).toContainText("Asked to raise the monthly cap");
    await expect(list).toContainText("Monthly cap raised to 5000 credits");
    await policy(page).getByLabel("Search").fill("");
    await policy(page).getByRole("group", { name: "Done by" }).getByRole("button", { name: "Architect" }).click();
    await expect(list).toContainText("Demo data was set up");
    const download = page.waitForEvent("download");
    await policy(page).getByRole("button", { name: /^Export CSV \(\d+\)$/ }).click();
    const file = await (await download).path();
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(file, "utf8").split("\r\n")[0]).toBe("When (UTC),Who,Kind,What,Action,On,Project,Details");
  });
});
