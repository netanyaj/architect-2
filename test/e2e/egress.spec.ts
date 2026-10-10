import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Data egress (C-4): where each project's data goes, a path the policy doesn't allow holding the deploy with the rule
   it breaks, the admin's inline fix on Launch, and the Governance section with a preview of unsaved hosts. */

const policy = (page: Page) => page.getByRole("region", { name: "Policy", exact: true });

test.describe("Data and egress", () => {
  test.setTimeout(200_000);
  let user: TestUser;
  let workspace: string;

  test.beforeAll(async () => {
    user = await createTestUser("egress");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });
  async function signInAndFind(page: Page) {
    await signIn(page, user);
    const { data: m } = await adminDb().from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
    workspace = m!.workspace_id;
  }

  test("an approved HubSpot part still can't send data to a host that isn't allowed: Launch holds it, an admin allows it", async ({ page }) => {
    await signInAndFind(page);
    const db = adminDb();
    const id = await seedPlan(user, "Lead brief");
    await db.from("items").update({ provider: "hubspot", title: "HubSpot contact lookup" }).eq("project_id", id).eq("key", "slack-brief-delivery");
    // HubSpot was approved for this project (C-3); the data rule (C-4) is separate.
    await db.from("approvals").insert({ workspace_id: workspace, project_id: id, kind: "connector", title: "Hubspot connector", status: "approved", payload: { provider: "hubspot" } });
    await page.goto(`/p/${id}?sim=fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    await expect(page.getByRole("link", { name: "Launch", exact: true })).toBeVisible({ timeout: 90_000 });

    await page.goto(`/p/${id}/launch`);
    const row = page.getByRole("listitem").filter({ hasText: "Contact details would go to api.hubapi.com, which isn't allowed" });
    await expect(row).toContainText("From HubSpot contact lookup. Data may only go to hosts on your allowed list (Data and egress).");
    await expect(page.getByRole("button", { name: "Share with your team" })).toHaveAttribute("aria-disabled", "true");
    const flow = page.getByRole("list", { name: "Where data goes" });
    await expect(flow.getByRole("listitem").filter({ hasText: "HubSpot" })).toContainText("Breaks the rule: Data may only go to hosts on your allowed list (Data and egress).");
    await expect(flow).toContainText("Taken out before it leaves: email addresses, phone numbers, payment card numbers.");

    // A Builder sees who can fix it, not a button.
    await db.from("members").update({ role: "builder" }).eq("workspace_id", workspace).eq("user_id", user.id);
    try {
      await page.reload();
      await expect(row).toContainText("An Owner or Admin can allow it.");
      await expect(row.getByRole("button", { name: "Allow api.hubapi.com" })).toHaveCount(0);
    } finally {
      await db.from("members").update({ role: "owner" }).eq("workspace_id", workspace).eq("user_id", user.id);
    }
    await page.reload();
    await row.getByRole("button", { name: "Allow api.hubapi.com" }).click();
    await expect(page.getByText("api.hubapi.com is allowed. Its data can go there now.")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "which isn't allowed" })).toHaveCount(0);
    const { data: egress } = await db.from("policies").select("config").eq("workspace_id", workspace).eq("kind", "egress").single();
    expect((egress!.config as { hosts: string[] }).hosts).toContain("api.hubapi.com");
  });

  test("Governance › Data and egress: the held project's path, a preview of an unsaved host, and Save", async ({ page }) => {
    // Its own person, so the host allowed in the test above isn't on this workspace's list.
    const other = await createTestUser("egress2");
    try {
      await signIn(page, other);
      const db = adminDb();
      const { data: m } = await db.from("members").select("workspace_id").eq("user_id", other.id).eq("role", "owner").single();
      const ws = m!.workspace_id;
      const id = await seedPlan(other, "Lead brief");
      await db.from("items").update({ provider: "hubspot", title: "HubSpot contact lookup" }).eq("project_id", id).eq("key", "slack-brief-delivery");
      await db.from("blueprints").update({ agreed_at: new Date().toISOString() }).eq("project_id", id);

      await page.goto("/governance?section=egress");
      await expect(page.getByRole("region", { name: "Policies", exact: true }).getByRole("button", { name: /Data and egress.*2 projects held/ })).toBeVisible();
      await expect(policy(page).getByLabel("Project", { exact: true })).toHaveValue(id);
      const flow = policy(page).getByRole("list", { name: "Where Lead brief's data goes" });
      await expect(flow.getByRole("listitem").filter({ hasText: "HubSpot" })).toContainText("Not allowed");

      await policy(page).getByLabel("Add a host").fill("hubapi.com");
      await policy(page).getByRole("button", { name: "Add host" }).click();
      await expect(flow.getByRole("listitem").filter({ hasText: "HubSpot" })).toContainText("Allowed");
      await expect(policy(page).getByText("Shown with your unsaved hosts. Save to apply them.")).toBeVisible();
      await policy(page).getByRole("checkbox", { name: "People's names" }).check();
      await policy(page).getByRole("button", { name: "Save data rules" }).click();
      await expect(policy(page).getByRole("status")).toContainText("Saved.");
      // Lead scorer (seeded, 0019) read HubSpot too, so allowing hubapi.com clears both.
      await expect(page.getByRole("region", { name: "Policies", exact: true }).getByRole("button", { name: /Data and egress/ })).not.toContainText("held");
      const { data: egress } = await db.from("policies").select("config").eq("workspace_id", ws).eq("kind", "egress").single();
      expect(egress!.config).toMatchObject({ hosts: ["slack.com", "googleapis.com", "zendesk.com", "api.clearbit.com", "hubapi.com"], redact: ["email", "phone", "card", "name"] });
    } finally {
      await deleteTestUser(other);
    }
  });
});
