import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Bring your own coding agent (F4, Simulated): a project token (approved under governance), a scripted MCP session
   with ?sim=byoagent, its activity lines, and the changed part waiting for its check (only the checker marks Works). */

test.describe("M4: Bring your own coding agent", () => {
  test.setTimeout(120_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("agentowner");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("the MCP spec page lists the tools, signed out too", async ({ page }) => {
    await page.goto("/docs/mcp");
    await expect(page.getByRole("heading", { name: "Architect's MCP server" })).toBeVisible();
    for (const tool of ["get_blueprint", "update_item", "run_in_sandbox", "run_tests", "open_pr", "request_approval", "get_preview_url"]) {
      await expect(page.locator(`li#${tool}`)).toContainText("Policy");
    }
    await expect(page.getByText("Claude Code", { exact: true })).toBeVisible();
    await expect(page.getByText("Cursor (.cursor/mcp.json)")).toBeVisible();
  });

  test("make a token, play ?sim=byoagent, see the activity and the part wait for its check", async ({ page }) => {
    await signIn(page, user);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const { data: p } = await db.from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", "Meeting Prep").single();

    // Without a token, the session says what's missing.
    await page.goto(`/p/${p!.id}?sim=byoagent`);
    await expect(page.getByRole("region", { name: "Coding agent session" })).toContainText("No coding agent is connected: make a project token first.");

    // ⋯ › Project settings › Coding agents: make a token; governance is on, so it waits for approval.
    await page.getByRole("button", { name: "More for this project" }).click();
    await page.getByRole("menuitem", { name: "Project settings" }).click();
    await page.getByLabel("Token name").fill("Claude Code");
    await page.getByRole("button", { name: "Make a token" }).click();
    const shown = page.getByRole("region", { name: "Your new token" });
    await expect(shown).toContainText("Copy this token now. It isn't shown again.");
    const token = (await shown.locator("code").textContent())!;
    expect(token).toMatch(/^ax_pt_[A-Za-z0-9_-]{43}$/);
    const tokens = page.getByRole("list", { name: "Tokens" });
    await expect(tokens).toContainText(`ax_pt_…${token.slice(-4)}`);
    await expect(tokens).toContainText("Waiting for approval");
    await tokens.getByRole("button", { name: "Approve" }).click();
    await expect(tokens).toContainText("Active");
    const { data: rows } = await db.from("project_tokens").select("token_hash, status").eq("project_id", p!.id);
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe("active");
    expect(rows![0].token_hash).not.toBe(token);

    // The scripted session: the agent's change waits for the checker.
    await page.goto(`/p/${p!.id}?sim=byoagent`);
    const session = page.getByRole("region", { name: "Coding agent session" });
    await expect(session).toContainText("Coding agent: Claude Code (you) · via MCP · updated ‘Brief writer’");
    await expect(session.getByRole("status")).toContainText("‘Brief writer’ is waiting for its check. Only the checker can mark it Works.");
    await expect(page.getByRole("complementary", { name: "Plan" })).toContainText("Waiting for its check · changed by Claude Code (you)");
    await expect(session).toContainText("tried to mark ‘Brief writer’ Works · refused: Only the checker can mark a part Works.");
    await expect(session).toContainText("Checker · Passed 3 of 3 · ‘Brief writer’ works", { timeout: 15_000 });
    await expect(session.getByRole("status")).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Plan" })).not.toContainText("Waiting for its check");
  });
});
