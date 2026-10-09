import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Try it without Lyzr Studio: with LYZR_API_KEY and LYZR_AGENT_ID unset on the server, Gemini answers through
   the gateway and the run says Simulated. Runs only against a server started without them:
     LYZR_API_KEY= LYZR_AGENT_ID= E2E_NO_LYZR=1 E2E_PORT=3101 pnpm e2e test/e2e/agents-fallback.spec.ts */

test.describe("M4: Agents without Lyzr Studio (Simulated)", () => {
  test.skip(process.env.E2E_NO_LYZR !== "1", "Needs a server started without LYZR_API_KEY and LYZR_AGENT_ID.");
  test.setTimeout(120_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("nolyzr");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("Try it is answered by Gemini, tagged Simulated, saved as a gateway run; nothing is made on Studio", async ({ page }) => {
    await signIn(page, user);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
    const { data: p } = await db.from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", "ticket-triage").single();
    await page.goto(`/p/${p!.id}?view=agents`);

    await page.getByRole("button", { name: "Urgency and team label: open its settings" }).click();
    const settings = page.getByRole("complementary", { name: "Urgency and team label settings" });
    // The sync line is simulated, and Open in Studio says why it can't open.
    await expect(settings.getByText("Synced with Lyzr Studio · just now")).toBeVisible();
    await expect(settings.getByRole("button", { name: "Open in Studio" })).toHaveAttribute("title", "Lyzr Studio isn't set up here.");

    await settings.getByRole("tab", { name: "Try it" }).click();
    await expect(settings.getByText(/Lyzr Studio isn't set up here, so Gemini answers through Architect's gateway/)).toBeVisible();
    await settings.getByRole("button", { name: "Run it" }).click();
    const answer = settings.getByRole("region", { name: "Answer" });
    await expect(answer).toBeVisible({ timeout: 60_000 });
    await expect(answer).toContainText("Answered by Gemini through Architect");
    await expect(answer.getByText("Simulated")).toBeVisible();
    await expect(answer.getByRole("link", { name: "Open in Studio" })).toHaveCount(0);

    const { data: agent } = await db.from("agents").select("id, lyzr_agent_id").eq("project_id", p!.id).eq("item_key", "urgency-and-team-label").single();
    expect(agent!.lyzr_agent_id).toBeNull();
    const { data: runs } = await db.from("agent_runs").select("runtime, status").eq("agent_id", agent!.id);
    expect(runs).toEqual([{ runtime: "gateway", status: "passed" }]);

    await settings.getByRole("tab", { name: "Runs" }).click();
    await expect(settings.getByRole("button", { name: /Try it · Answered by Gemini through Architect/ })).toContainText("Simulated");
  });
});
