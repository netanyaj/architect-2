import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Developer view (screen 8): on an imported project the files are real (read through the GitHub App); on a new
   project, Changes lists every part's files compared with main, grouped by part. */

const INSTALLATION = Number(process.env.E2E_GITHUB_INSTALLATION ?? 167616247);
const REPO = "netanyaj/ticket-triage";

const files = (page: Page) => page.getByRole("complementary", { name: "Files" });
const viewer = (page: Page) => page.getByRole("region", { name: "Viewer" });

async function workspaceOf(user: TestUser) {
  const { data } = await adminDb().from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
  return data!.workspace_id;
}

test.describe("M4: Developer view", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("developer");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("an imported project shows the repo's real files, read from GitHub", async ({ page }) => {
    await signIn(page, user);
    const ws = await workspaceOf(user);
    const db = adminDb();
    // The repo's current commit (public repo), as an import records it.
    const head = (await (await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { accept: "application/vnd.github+json" } })).json()) as { sha: string };
    await db.from("github_installations").insert({ workspace_id: ws, installation_id: INSTALLATION, account_login: "netanyaj", account_type: "User", added_by: user.id });
    const { data: project } = await db
      .from("projects")
      .insert({ workspace_id: ws, name: "ticket-triage import", owner_id: user.id, status: "draft", model: "gemini", stack: "Node.js (Express), React 18 (Vite) and Python (CrewAI)", repo_full_name: REPO, icon: "repo" })
      .select("id")
      .single();
    await db.from("repo_imports").insert({
      workspace_id: ws,
      project_id: project!.id,
      installation_id: INSTALLATION,
      full_name: REPO,
      branch: "main",
      folder: "/",
      commit_sha: head.sha,
      created_by: user.id,
      analysis: { analysis: { keys: [{ name: "OPENAI_API_KEY", service: null, lyzrInstead: true }, { name: "SLACK_WEBHOOK_URL", service: "slack", lyzrInstead: false }], testCommand: "npm test" }, behaviour: [], behaviourError: null },
    });

    // From ⋯ › Developer view.
    await page.goto(`/p/${project!.id}`);
    await page.getByRole("button", { name: "More for this project" }).click();
    await page.getByRole("menuitem", { name: "Developer view" }).click();
    await page.waitForURL(/dev=1/);
    await expect(page.getByText("Developer view", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Code" })).toHaveAttribute("aria-selected", "true");

    // Nothing built yet, so Code opens on All files: the real tree.
    await expect(files(page).getByRole("tab", { name: "All files" })).toHaveAttribute("aria-selected", "true");
    await expect(files(page)).toContainText(`${REPO} · main at ${head.sha.slice(0, 7)} · real files`, { timeout: 30_000 });
    await files(page).getByRole("button", { name: "triage.js" }).click();
    await expect(viewer(page)).toContainText("From GitHub");
    await expect(viewer(page)).toContainText("export function ruleTriage(ticket)", { timeout: 30_000 });

    // Changes: nothing yet, until Build.
    await files(page).getByRole("tab", { name: /^Changes 0$/ }).click();
    await expect(files(page)).toContainText("No changes yet.");
    await files(page).getByRole("tab", { name: "All files" }).click();

    // Keys and passwords: names only, per version.
    await files(page).getByRole("button", { name: /Environment · Keys and passwords/ }).click();
    await expect(viewer(page).getByRole("cell", { name: /OPENAI_API_KEY/ })).toBeVisible();
    await expect(viewer(page).getByRole("columnheader", { name: "Team version" })).toBeVisible();
  });

  test("a new project: Changes grouped by part, the terminal and the activity of its build", async ({ page }) => {
    await signIn(page, user);
    const id = await seedPlan(user, "Dev Prep");
    await page.goto(`/p/${id}?sim=fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    await expect(page.getByRole("link", { name: "Launch", exact: true })).toBeVisible({ timeout: 120_000 });

    await page.goto(`/p/${id}?dev=1`);
    await expect(page.getByRole("tab", { name: "Code" })).toHaveAttribute("aria-selected", "true");
    // The branch and its pull request.
    await expect(page.getByText("architect/plan-v1", { exact: true })).toBeVisible();
    await expect(page.getByText(/PR #\d+ · checks (passing|failing)/)).toBeVisible();

    // Changes, grouped by part, each with its files.
    await expect(files(page).getByRole("tab", { name: /^Changes \d+$/ })).toBeVisible();
    const group = files(page).getByRole("region", { name: /^Talking points generator · new/ });
    await expect(group).toBeVisible();
    await expect(group.getByRole("button", { name: /agents\/talking-points-generator\.py/ })).toBeVisible();
    await expect(group.getByRole("button", { name: /checks\/talking-points-generator\.yaml/ })).toBeVisible();
    await expect(files(page).getByRole("region", { name: /^Slack brief message · / })).toBeVisible();
    await expect(files(page).getByRole("region", { name: /^Project · new/ })).toContainText("plan.yaml");
    await group.getByRole("button", { name: /agents\/talking-points-generator\.py/ }).click();
    await expect(viewer(page).getByLabel(/^Changes to agents\/talking-points-generator\.py$/)).toContainText('name="Talking points generator"');

    // Activity: the checker, the Architect agent, a coding agent via MCP and GitHub.
    const activity = page.getByRole("complementary", { name: "Activity" });
    await expect(activity).toContainText("Checker");
    await expect(activity).toContainText("Architect agent");
    await expect(activity).toContainText("Claude Code (you) · via MCP");
    await expect(activity).toContainText("GitHub");

    // Terminal: the run's commands, replayed.
    await page.getByRole("tab", { name: "Terminal" }).click();
    const log = page.getByRole("log", { name: "Terminal" });
    await expect(log).toContainText("$ git switch -c architect/plan-v1");
    await expect(log).toContainText('$ architect build "Talking points generator"');
    await expect(log).toContainText("assertions passed");
  });
});
