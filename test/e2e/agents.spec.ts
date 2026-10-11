import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Agents (screen 9): the graph, a node's settings, and Try it running the agent for real on Lyzr Studio.
   Needs LYZR_API_KEY on the server under test. The Simulated fallback (no key) is agents-fallback.spec.ts. */

const LYZR = "https://agent-prod.studio.lyzr.ai";

async function projectId(user: TestUser, name: string) {
  const db = adminDb();
  const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
  const { data: p } = await db.from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", name).single();
  return p!.id;
}

/** The Studio agents this test made, so they can be removed from Lyzr afterwards. */
async function studioAgents(id: string): Promise<string[]> {
  const { data } = await adminDb().from("agents").select("lyzr_agent_id").eq("project_id", id).not("lyzr_agent_id", "is", null);
  return (data ?? []).map((a) => a.lyzr_agent_id!);
}

const panel = (page: Page, name: string) => page.getByRole("complementary", { name: `${name} settings` });

test.describe("M4: Agents", () => {
  test.setTimeout(150_000);
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

  test("any plan: open Agents, open a node, Try it runs on Lyzr Studio for real and is saved as a run", async ({ page }) => {
    await signIn(page, user);
    const id = await projectId(user, "ticket-triage");
    await page.goto(`/p/${id}?view=agents`);

    // The graph is the default: what starts it, labelled hand-offs, where it delivers.
    const graph = page.getByRole("group", { name: "How the agents connect" });
    await expect(graph.getByRole("button", { name: "Urgency and team label: open its settings" })).toBeVisible();
    await expect(graph.getByText("Hands over urgency and team label")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Plan" }).getByText("AI agents")).toBeVisible();

    await graph.getByRole("button", { name: "Urgency and team label: open its settings" }).click();
    const settings = panel(page, "Urgency and team label");
    await expect(settings.getByText("Runtime: Lyzr Studio")).toBeVisible();
    await expect(settings.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");

    // Settings: an edit is counted, holds the stage action, and Save clears it.
    const instructions = settings.getByLabel("Instructions");
    await instructions.fill("Label each ticket with one urgency (low, normal, urgent) and one team. Answer in one line.");
    await expect(settings.getByText("1 unsaved change")).toBeVisible();
    await expect(page.locator('header [title="Save or discard your agent changes first."]')).toBeVisible();
    await settings.getByRole("button", { name: "Save changes" }).click();
    await expect(settings.getByText("All changes saved")).toBeVisible({ timeout: 30_000 });
    // Save made the node's own Studio agent; the sync line is real now.
    await expect(settings.getByText(/^Synced with Lyzr Studio · /)).toBeVisible();
    await expect(settings.getByRole("link", { name: "Open in Studio" })).toHaveAttribute("href", /^https:\/\/studio\.lyzr\.ai\/agent-create\/[a-z0-9]+$/);

    // Try it: a real answer from Lyzr Studio.
    await settings.getByRole("tab", { name: "Try it" }).click();
    await expect(settings.getByText(/Runs on Lyzr Studio as its own Studio agent/)).toBeVisible();
    await settings.getByRole("button", { name: "Run on Lyzr Studio" }).click();
    const answer = settings.getByRole("region", { name: "Answer" });
    await expect(answer).toBeVisible({ timeout: 60_000 });
    await expect(answer).toContainText("Runs on Lyzr Studio");
    await expect(answer.getByText("Simulated")).toHaveCount(0);

    // It's saved as a run, on the node's own Studio agent.
    await settings.getByRole("tab", { name: "Runs" }).click();
    await expect(settings.getByRole("button", { name: /Try it · Runs on Lyzr Studio/ }).first()).toBeVisible();
    const db = adminDb();
    const { data: agent } = await db.from("agents").select("id, lyzr_agent_id, instructions").eq("project_id", id).eq("item_key", "urgency-and-team-label").single();
    expect(agent!.instructions).toMatch(/^Label each ticket with one urgency/);
    expect(agent!.lyzr_agent_id).toMatch(/^[a-z0-9]{24}$/);
    const { data: runs } = await db.from("agent_runs").select("runtime, status, output, model_label").eq("agent_id", agent!.id);
    expect(runs).toHaveLength(1);
    expect(runs![0]).toMatchObject({ runtime: "lyzr_agent", status: "passed" });
    expect(runs![0].output!.length).toBeGreaterThan(5);
    made.push(...(await studioAgents(id)));
  });

  test("Meeting Prep keeps its sample agents: the Research agent from Studio, then the Brief writer", async ({ page }) => {
    await signIn(page, user);
    const id = await projectId(user, "Meeting Prep");
    await page.goto(`/p/${id}?view=agents`);
    const graph = page.getByRole("group", { name: "How the agents connect" });
    await expect(graph.getByRole("button", { name: "Research agent: open its settings" })).toContainText("AI agent · from Lyzr Studio");
    await expect(graph.getByText("Meeting coming up")).toBeVisible();
    await expect(graph.getByText("Hands over findings")).toBeVisible();
    await expect(graph.getByRole("button", { name: /^HubSpot, a tool of Research agent/ })).toContainText("waiting for IT");
    await graph.getByRole("button", { name: "Brief writer: open its settings" }).click();
    const settings = panel(page, "Brief writer");
    await expect(settings.getByLabel("Instructions")).toHaveValue(/Stay under 200 words/);
    // Sample runs are labelled Simulated.
    await settings.getByRole("tab", { name: "Runs" }).click();
    await expect(settings.getByRole("listitem").filter({ hasText: "Check run during the build" }).or(settings.getByRole("listitem").filter({ hasText: "Build check" })).first().getByText("Simulated")).toBeVisible();
    await settings.getByRole("tab", { name: "Checks" }).click();
    await expect(settings.getByText("Its check")).toBeVisible();
    made.push(...(await studioAgents(id)));
  });
});
