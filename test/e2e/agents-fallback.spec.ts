import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, demoWorkspace, type TestUser } from "./helpers";

/* Try it without the workspace's own Lyzr key (M5.10, the default for a new workspace): Gemini answers through the
   gateway, the panel says "Simulated · connect your Lyzr key to make this real", and no Lyzr account is called. */

test.describe("M4 · M5.10: Agents without the workspace's Lyzr key (Simulated)", () => {
  test.setTimeout(120_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("nolyzr");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("Try it is answered by Gemini, saved as a gateway run; nothing is made in any Studio; Attach shows only the connect prompt", async ({ page }) => {
    await signIn(page, user);
    const db = adminDb();
    const { data: p } = await db.from("projects").select("id").eq("workspace_id", await demoWorkspace(user)).eq("name", "ticket-triage").single();
    await page.goto(`/p/${p!.id}?view=agents`);

    await page.getByRole("button", { name: "Urgency and team label: open its settings" }).click();
    const settings = page.getByRole("complementary", { name: "Urgency and team label settings" });
    await expect(settings.getByText("Simulated · connect your Lyzr key to make this real")).toBeVisible();
    await expect(settings.getByRole("link", { name: "Connect your Lyzr key" })).toHaveAttribute("href", "/connections#lyzr");
    await expect(settings.getByRole("button", { name: "Open in Studio" })).toHaveAttribute("title", "Connect your Lyzr key");

    await settings.getByRole("tab", { name: "Try it" }).click();
    await expect(settings.getByText(/Gemini answers in its place until this workspace connects its Lyzr key/)).toBeVisible();
    await settings.getByRole("button", { name: "Run it" }).click();
    const answer = settings.getByRole("region", { name: "Answer" });
    await expect(answer).toBeVisible({ timeout: 60_000 });
    await expect(answer).toContainText("Answered by Gemini through Architect");
    await expect(answer.getByRole("link", { name: "Open in Studio" })).toHaveCount(0);

    const { data: agent } = await db.from("agents").select("id, lyzr_agent_id").eq("project_id", p!.id).eq("item_key", "urgency-and-team-label").single();
    expect(agent!.lyzr_agent_id).toBeNull();
    const { data: runs } = await db.from("agent_runs").select("runtime, status").eq("agent_id", agent!.id);
    expect(runs).toEqual([{ runtime: "gateway", status: "passed" }]);

    // Attach Studio agent: no list (never another account's agents), only the connect prompt.
    await page.goto("/home");
    await page.getByRole("button", { name: "Add files, agents or tools" }).click();
    await page.getByRole("menuitem", { name: /Attach a Lyzr Studio agent/ }).click();
    const dialog = page.getByRole("dialog", { name: "Attach a Lyzr Studio agent" });
    await expect(dialog.getByRole("link", { name: "Connect your Lyzr key" })).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole("list", { name: "Studio agents" })).toHaveCount(0);
  });
});
