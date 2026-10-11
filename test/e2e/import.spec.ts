import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Import a repo (screen 10, F3): real GitHub through the App installed on netanyaj/ticket-triage, real analysis,
   and a real plan from the repo. The GitHub sign-in that confirms an installation can't run in a test browser, so
   the test gives the workspace that installation directly, as the callback would after GitHub confirms it. */

const INSTALLATION = Number(process.env.E2E_GITHUB_INSTALLATION ?? 167616247);
const REPO = "netanyaj/ticket-triage";

async function workspaceOf(user: TestUser) {
  const { data } = await adminDb().from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
  return data!.workspace_id;
}

test.describe("M4: Import a repo", () => {
  // One account through the three steps, in order.
  test.describe.configure({ mode: "serial" });
  test.setTimeout(180_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("importer");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("without GitHub connected: install the App, or connect one that's already installed", async ({ page }) => {
    await signIn(page, user);
    await page.goto("/import");
    await expect(page.getByRole("heading", { name: "Connect GitHub first" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Install the GitHub App" })).toHaveAttribute("href", /^https:\/\/github\.com\/apps\/[\w-]+\/installations\/new$/);
    await expect(page.getByRole("link", { name: "Already installed? Connect it" })).toHaveAttribute("href", "/api/github/connect");
    await expect(page.getByText("New projects use Next.js + Python (Lyzr SDK) + Postgres + sign-in. Imported projects keep their stack.")).toBeVisible();
    // An installation id in a link is never trusted: it goes through GitHub's own sign-in for the App.
    const res = await page.request.get("/import?installation_id=1&setup_action=install", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toMatch(/\/api\/github\/connect$/);
  });

  test("ticket-triage: choose it, understand it, and get a plan from the repo with its stack, tests and agents", async ({ page }) => {
    await signIn(page, user);
    const ws = await workspaceOf(user);
    const db = adminDb();
    await db.from("github_installations").upsert({ workspace_id: ws, installation_id: INSTALLATION, account_login: "netanyaj", account_type: "User", added_by: user.id }, { onConflict: "workspace_id,installation_id" });
    await page.goto("/import");

    // Choose repo: the App can read only the repos it was installed on.
    const repos = page.getByRole("list", { name: "Repos" });
    await repos.getByRole("button", { name: new RegExp(REPO) }).click();
    await expect(page.getByLabel("Branch")).toHaveValue("main");
    await expect(page.getByLabel("Folder")).toContainText("Whole repo");
    await page.getByRole("button", { name: "Understand it", exact: true }).click();

    // Understand it: static analysis of the real repo.
    await expect(page.getByRole("heading", { name: "Architect can run this as it is" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("region", { name: "How it's built" })).toContainText("Node.js (Express), React 18 (Vite) and Python (CrewAI)");
    await expect(page.getByRole("region", { name: "How it starts" })).toContainText("npm run dev");
    await expect(page.getByRole("region", { name: "AI agents" })).toContainText("triager");
    await expect(page.getByRole("region", { name: "AI agents" })).toContainText("CrewAI");
    await expect(page.getByRole("region", { name: "Keys it needs" })).toContainText("OPENAI_API_KEY");
    await expect(page.getByRole("region", { name: "Keys it needs" })).toContainText("SLACK_WEBHOOK_URL");
    const tests = page.getByRole("region", { name: "Your tests become the checks" });
    await expect(tests).toContainText(/of your 3 tests prove \d of the \d parts/);
    await expect(tests).toContainText("Architect read");

    // Plan from repo: the plan is written as any other, and nothing is built.
    await page.getByRole("button", { name: "Write the plan", exact: true }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
    const projectId = page.url().split("/p/")[1];
    await expect(page.getByRole("button", { name: /^Build · ~\d+ credits$/ })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Stack: Node\.js \(Express\), React 18 \(Vite\) and Python \(CrewAI\), kept from your repo/)).toBeVisible();
    await expect(page.getByText(`From ${REPO} on GitHub.`, { exact: false })).toBeVisible();

    const { data: project } = await db.from("projects").select("repo_full_name, stack, status").eq("id", projectId).single();
    expect(project).toEqual({ repo_full_name: REPO, stack: "Node.js (Express), React 18 (Vite) and Python (CrewAI)", status: "draft" });
    const { data: bp } = await db.from("blueprints").select("id, generation").eq("project_id", projectId).single();
    expect(bp!.generation).toBe("ready");
    const { data: items } = await db.from("items").select("id, title, grp, status, framework, status_detail").eq("blueprint_id", bp!.id);
    const { data: imp } = await db.from("repo_imports").select("analysis").eq("project_id", projectId).single();
    const behaviour = (imp!.analysis as { behaviour: { title: string; tests: string[]; agent: string | null }[] }).behaviour;
    // Every part of today's behaviour that has tests gets them as its check and proof; it works when they all pass.
    // "SSO login failure is P1" is marked as failing in the repo, so its part is never Works: Build fixes it.
    const { data: proofs } = await db.from("proofs").select("item_id, result, summary").in("item_id", items!.map((i) => i.id));
    expect(proofs!.length).toBeGreaterThan(0);
    for (const p of proofs!) {
      const item = items!.find((i) => i.id === p.item_id)!;
      if (p.result === "pass") {
        expect(item.status).toBe("built");
        expect(p.summary).toMatch(/ of your tests prove it$/);
      } else {
        expect(item.status).toBe("proposed");
        expect(p.summary).toContain('"SSO login failure is P1" is marked as failing in your code');
        expect(item.status_detail).toBe('Your test "SSO login failure is P1" fails today. Build fixes it.');
      }
    }
    // The CrewAI agent is its own part and keeps its framework.
    expect(behaviour.some((b) => b.agent === "triager")).toBe(true);
    expect(items!.some((i) => i.grp === "agents" && i.framework === "crewai")).toBe(true);
    const { count: runs } = await db.from("runs").select("id", { count: "exact", head: true }).eq("project_id", projectId);
    expect(runs).toBe(0);

    // The import page marks the repo as already a project.
    await page.goto("/import");
    await expect(page.getByRole("link", { name: "Open ticket-triage" })).toBeVisible({ timeout: 30_000 });
  });

  test("a lost installation says what happened and what to do", async ({ page }) => {
    await signIn(page, user);
    const ws = await workspaceOf(user);
    const db = adminDb();
    await db.from("github_installations").delete().eq("workspace_id", ws);
    await db.from("github_installations").insert({ workspace_id: ws, installation_id: 1, account_login: "gone-account", account_type: "User", added_by: user.id });
    await page.goto("/import");
    const alert = page.getByRole("alert").filter({ hasText: "The GitHub App isn't installed on this account any more. Install it on the repos you want to import." });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("link", { name: "Install on more repos" })).toBeVisible();
  });
});
