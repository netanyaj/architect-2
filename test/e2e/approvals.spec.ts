import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Approvals (C-5, screen 11, F5/F6): a part that uses an app the policy doesn't allow files a request; an admin
   approves it for that project with a reason and the part asks to connect; "allow everywhere" makes a rule shown in
   Rules; a rejection needs a reason; a Live deploy approval; the pages are for Owners and Admins with governance on. */

const panel = (page: Page) => page.getByRole("complementary", { name: "Plan" });
const requests = (page: Page) => page.getByRole("region", { name: "Requests" });
const detail = (page: Page) => page.getByRole("region", { name: "Request", exact: true });

test.describe("Approvals", () => {
  test.setTimeout(150_000);
  let user: TestUser;
  let workspace: string;

  test.beforeAll(async () => {
    user = await createTestUser("approver");
  });
  // The seeded workspace is made on first sign-in.
  async function signInAndFind(page: Page) {
    await signIn(page, user);
    const { data: m } = await adminDb().from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
    workspace = m!.workspace_id;
  }
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("F5: a HubSpot part files a request; approved for that project, the part asks to connect and then works", async ({ page }) => {
    await signInAndFind(page);
    const db = adminDb();
    const id = await seedPlan(user, "Lead brief");
    // The plan's Slack part becomes a HubSpot lookup, which the seeded policy doesn't allow.
    await db.from("items").update({ provider: "hubspot", title: "HubSpot contact lookup", description: "Look up each attendee's company and deal stage" }).eq("project_id", id).eq("key", "slack-brief-delivery");

    await page.goto(`/p/${id}?sim=fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    await expect(page.getByRole("link", { name: "Launch", exact: true })).toBeVisible({ timeout: 90_000 });
    const { data: req } = await db.from("approvals").select("id, status, payload").eq("project_id", id).eq("kind", "connector").single();
    expect(req!.status).toBe("waiting");
    expect(req!.payload).toMatchObject({ provider: "hubspot", item_title: "HubSpot contact lookup" });

    await page.goto(`/governance/approvals?id=${req!.id}`);
    await expect(detail(page).getByRole("heading", { name: "Add HubSpot to Lead brief" })).toBeVisible();
    await expect(detail(page)).toContainText("New tool · rule: tools not on your approved list need an admin");
    await expect(detail(page)).toContainText("from the plan part “HubSpot contact lookup”");
    await expect(detail(page)).toContainText("api.hubapi.com · not on your allowed list");
    // Reject needs a reason; it says so instead of failing silently.
    await expect(detail(page).getByRole("button", { name: "Reject" })).toHaveAttribute("aria-disabled", "true");
    await detail(page).getByLabel(/^Reason/).fill("Sales needs deal stages in the brief");
    await detail(page).getByRole("button", { name: "Approve for this project" }).click();
    await expect(detail(page).getByRole("status")).toContainText("Approved.");

    // Decided keeps who, when and why; an audit row is written.
    await requests(page).getByRole("button", { name: /^Decided/ }).click();
    await requests(page).getByRole("button", { name: /Add HubSpot to Lead brief/ }).click();
    await expect(detail(page)).toContainText(/Approved by .+ · \d{1,2} \w{3}/);
    await expect(detail(page)).toContainText("“Sales needs deal stages in the brief”");
    await expect.poll(async () => (await db.from("audit_log").select("action").eq("workspace_id", workspace).eq("action", "approval.approved")).data?.length).toBe(1);

    // The part asks to connect HubSpot; connecting makes it work (F5).
    await page.goto(`/p/${id}`);
    await panel(page).getByRole("button", { name: "Connect HubSpot account" }).click();
    await page.getByRole("dialog", { name: "Connect HubSpot" }).getByRole("button", { name: "Allow" }).click();
    await expect(panel(page).getByRole("button", { name: "Connect HubSpot account" })).toHaveCount(0);
    await expect.poll(async () => (await db.from("items").select("status").eq("project_id", id).eq("key", "slack-brief-delivery").single()).data?.status).toBe("built");
  });

  test("allow everywhere makes a rule in Rules; a rejection needs a reason; Live approval waits for the team version", async ({ page }) => {
    await signInAndFind(page);
    const db = adminDb();
    await page.goto("/governance/approvals");

    // The seeded HubSpot request is for the whole workspace: only "allow everywhere" fits it.
    await requests(page).getByRole("button", { name: /Allow HubSpot in the workspace/ }).click();
    await expect(detail(page).getByRole("button", { name: "Approve for this project" })).toHaveCount(0);
    await detail(page).getByRole("button", { name: "Approve and allow everywhere" }).click();
    await expect(detail(page).getByRole("status")).toContainText("Approved.");
    await requests(page).getByRole("button", { name: "Rules" }).click();
    await requests(page).getByRole("button", { name: /HubSpot allowed in every project/ }).click();
    await expect(detail(page)).toContainText("Made from an approval");
    const { data: policy } = await db.from("policies").select("config").eq("workspace_id", workspace).eq("kind", "connectors").single();
    expect((policy!.config as { deny: string[] }).deny).not.toContain("hubspot");
    // Removing it, after a confirmation, puts HubSpot back behind an admin.
    await detail(page).getByRole("button", { name: "Remove rule" }).click();
    await detail(page).getByRole("group", { name: "Remove this rule?" }).getByRole("button", { name: "Remove rule" }).click();
    await expect(requests(page).getByRole("button", { name: /HubSpot allowed in every project/ })).toHaveCount(0);

    // Reject the seeded coding-agent token with a reason.
    await requests(page).getByRole("button", { name: /^Waiting/ }).click();
    await requests(page).getByRole("button", { name: /Claude Code token for Sam/ }).click();
    await detail(page).getByLabel(/^Reason/).fill("Sam's agent should start read-only");
    await detail(page).getByRole("button", { name: "Reject" }).click();
    await expect(detail(page).getByRole("status")).toContainText("Rejected.");

    // ticket-triage's Live request: approved, but it can't go live before its team version; Launch says who approved.
    await requests(page).getByRole("button", { name: /Make ticket-triage live/ }).click();
    await expect(requests(page).getByRole("button", { name: /Make ticket-triage live/ })).toContainText("Sam · 5 of 6 parts work");
    await detail(page).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(detail(page).getByRole("status")).toContainText("Make ticket-triage live: Approved. ticket-triage isn't live yet: Share this version with your team first.");
    const { data: tt } = await db.from("projects").select("id").eq("workspace_id", workspace).eq("name", "ticket-triage").single();
    await page.goto(`/p/${tt!.id}/launch`);
    await expect(page.getByText(/approved Live for this version\./)).toBeVisible();

    // Nothing left waiting: the empty state says what to do next.
    await page.goto("/governance/approvals");
    await expect(detail(page).getByRole("heading", { name: "Nothing waiting" })).toBeVisible();
  });

  test("only Owners and Admins, and only with governance on, see the governance pages", async ({ page }) => {
    await signInAndFind(page);
    const db = adminDb();
    await db.from("workspaces").update({ governance_enabled: false }).eq("id", workspace);
    try {
      await page.goto("/governance/approvals");
      await expect(page.getByText(/could not be found|not found/i).first()).toBeVisible();
      await page.goto("/home");
      await expect(page.getByRole("link", { name: /^Approvals/ })).toHaveCount(0);
    } finally {
      await db.from("workspaces").update({ governance_enabled: true }).eq("id", workspace);
    }
    await db.from("members").update({ role: "builder" }).eq("workspace_id", workspace).eq("user_id", user.id);
    try {
      await page.goto("/governance");
      await expect(page.getByText(/could not be found|not found/i).first()).toBeVisible();
    } finally {
      await db.from("members").update({ role: "owner" }).eq("workspace_id", workspace).eq("user_id", user.id);
    }
  });
});
