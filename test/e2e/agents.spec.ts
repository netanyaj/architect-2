import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, demoWorkspace, type TestUser } from "./helpers";

/* Agents (screen 9, M5.10): each workspace's own Lyzr Studio. Connecting the key in Connections, an agent whose part
   works made in that Studio (Not in Studio yet · Retry), saved edits syncing, Try it on it for real, and the shared,
   read-only demo agent. Needs LYZR_API_KEY (used here as the test workspace's own key) and LYZR_AGENT_ID on the server. */

const LYZR = "https://agent-prod.studio.lyzr.ai";

async function projectId(user: TestUser, name: string) {
  const { data: p } = await adminDb().from("projects").select("id").eq("workspace_id", await demoWorkspace(user)).eq("name", name).single();
  return p!.id;
}

/** The Studio agents this test made, so they can be removed from Lyzr afterwards. */
async function studioAgents(id: string): Promise<string[]> {
  const { data } = await adminDb().from("agents").select("lyzr_agent_id").eq("project_id", id).not("lyzr_agent_id", "is", null);
  return (data ?? []).map((a) => a.lyzr_agent_id!);
}

const panel = (page: Page, name: string) => page.getByRole("complementary", { name: `${name} settings` });

test.describe("M4 · M5.10: Agents in the workspace's own Lyzr Studio", () => {
  test.setTimeout(180_000);
  let user: TestUser;
  const made: string[] = [];

  test.beforeAll(async () => {
    user = await createTestUser("agents");
  });
  test.afterAll(async () => {
    if (process.env.LYZR_API_KEY) {
      for (const id of made) await fetch(`${LYZR}/v3/agents/${id}`, { method: "DELETE", headers: { "x-api-key": process.env.LYZR_API_KEY } }).catch(() => {});
    }
    if (user) await deleteTestUser(user);
  });

  test("without a key Studio actions are Simulated; connect it in Connections, Retry makes the agent there, Save syncs, Try it runs it", async ({ page }) => {
    await signIn(page, user);
    const id = await projectId(user, "ticket-triage");
    await page.goto(`/p/${id}?view=agents`);
    const graph = page.getByRole("group", { name: "How the agents connect" });
    await graph.getByRole("button", { name: "Urgency and team label: open its settings" }).click();
    let settings = panel(page, "Urgency and team label");
    // No key: one label says how to make it real; Open in Studio says why it can't open.
    await expect(settings.getByText("Simulated · connect your Lyzr key to make this real")).toBeVisible();
    await expect(settings.getByRole("button", { name: "Open in Studio" })).toHaveAttribute("title", "Connect your Lyzr key");

    // Connect the workspace's own key (Owner). It's checked with Lyzr, then only its last 4 characters are shown.
    await page.goto("/connections");
    const card = page.getByRole("region", { name: "Lyzr Studio" });
    await card.getByLabel("Lyzr API key").fill(process.env.LYZR_API_KEY!);
    await card.getByRole("button", { name: "Connect with your Lyzr API key" }).click();
    await expect(card.getByText(`Key ending ${process.env.LYZR_API_KEY!.slice(-4)}`)).toBeVisible({ timeout: 30_000 });
    expect(await page.content()).not.toContain(process.env.LYZR_API_KEY!);

    // The part works but its agent isn't in Studio yet: Retry makes it there.
    await page.goto(`/p/${id}?view=agents`);
    await graph.getByRole("button", { name: "Urgency and team label: open its settings" }).click();
    settings = panel(page, "Urgency and team label");
    await expect(settings.getByText("Not in Studio yet")).toBeVisible();
    await settings.getByRole("button", { name: "Retry" }).click();
    await expect(settings.getByText(/^Synced with Lyzr Studio · /)).toBeVisible({ timeout: 30_000 });
    await expect(settings.getByRole("link", { name: "Open in Studio" })).toHaveAttribute("href", /^https:\/\/studio\.lyzr\.ai\/agent-create\/[a-z0-9]+$/);
    await expect(settings.getByText("Partly simulated")).toBeVisible();

    // A saved edit syncs to Studio.
    await settings.getByLabel("Instructions").fill("Label each ticket with one urgency (low, normal, urgent) and one team. Answer in one line.");
    await expect(settings.getByText("1 unsaved change")).toBeVisible();
    await settings.getByRole("button", { name: "Save changes" }).click();
    await expect(settings.getByText("All changes saved")).toBeVisible({ timeout: 30_000 });

    // Try it: a real answer from the workspace's own Studio.
    await settings.getByRole("tab", { name: "Try it" }).click();
    await expect(settings.getByText(/Runs in your workspace's Lyzr Studio as its own agent/)).toBeVisible();
    await settings.getByRole("button", { name: "Run on Lyzr Studio" }).click();
    const answer = settings.getByRole("region", { name: "Answer" });
    await expect(answer).toBeVisible({ timeout: 60_000 });
    await expect(answer).toContainText("Runs on Lyzr Studio");

    const db = adminDb();
    const { data: agent } = await db.from("agents").select("id, lyzr_agent_id, instructions").eq("project_id", id).eq("item_key", "urgency-and-team-label").single();
    expect(agent!.instructions).toMatch(/^Label each ticket with one urgency/);
    expect(agent!.lyzr_agent_id).toMatch(/^[a-z0-9]{24}$/);
    const { data: runs } = await db.from("agent_runs").select("runtime, status").eq("agent_id", agent!.id);
    expect(runs).toEqual([{ runtime: "lyzr_agent", status: "passed" }]);
    made.push(...(await studioAgents(id)));
  });

  test("Meeting Prep: the Research agent is the shared demo agent, Try it only; the Brief writer is the workspace's own", async ({ page }) => {
    await signIn(page, user);
    const id = await projectId(user, "Meeting Prep");
    await page.goto(`/p/${id}?view=agents`);
    const graph = page.getByRole("group", { name: "How the agents connect" });
    await expect(graph.getByRole("button", { name: "Research agent: open its settings" })).toContainText("AI agent · demo agent");
    await expect(graph.getByText("Hands over findings")).toBeVisible();
    await graph.getByRole("button", { name: "Research agent: open its settings" }).click();
    const research = panel(page, "Research agent");
    await expect(research.getByText("Demo agent · shared and read-only")).toBeVisible();
    await expect(research.getByRole("button", { name: "Open in Studio" })).toHaveAttribute("title", /lives in Architect's own Studio account/);
    // Read-only: no Save bar.
    await expect(research.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await research.getByRole("tab", { name: "Try it" }).click();
    await expect(research.getByText(/The demo agent runs for real on Lyzr Studio, in Architect's own account/)).toBeVisible();
    await research.getByRole("button", { name: "Run on Lyzr Studio" }).click();
    await expect(research.getByRole("region", { name: "Answer" })).toContainText("shared demo agent", { timeout: 60_000 });

    await graph.getByRole("button", { name: "Brief writer: open its settings" }).click();
    const writer = panel(page, "Brief writer");
    await expect(writer.getByLabel("Instructions")).toHaveValue(/Stay under 200 words/);
    await writer.getByRole("tab", { name: "Checks" }).click();
    await expect(writer.getByText("Its check")).toBeVisible();
    made.push(...(await studioAgents(id)));
  });
});
