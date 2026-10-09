import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* M4 acceptance, F3 in one go: import netanyaj/ticket-triage through the GitHub App (real), write the plan from the
   repo (real, Gemini), build it (simulated), and the build opens a pull request listing its parts (simulated). */

test.describe("M4 acceptance: F3 import → plan from repo → build → PR", () => {
  test.setTimeout(300_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("fthree");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("import ticket-triage, plan it, build it, and see its pull request", async ({ page }) => {
    await signIn(page, user);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
    await db.from("github_installations").insert({ workspace_id: m!.workspace_id, installation_id: Number(process.env.E2E_GITHUB_INSTALLATION ?? 167616247), account_login: "netanyaj", account_type: "User", added_by: user.id });

    // Import: choose the repo, understand it.
    await page.goto("/import");
    await page.getByRole("list", { name: "Repos" }).getByRole("button", { name: /netanyaj\/ticket-triage/ }).click();
    await expect(page.getByLabel("Branch")).toHaveValue("main");
    await page.getByRole("button", { name: "Understand it", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Architect can run this as it is" })).toBeVisible({ timeout: 60_000 });

    // Plan from repo.
    await page.getByRole("button", { name: "Write the plan", exact: true }).click();
    await page.waitForURL(/\/p\/[0-9a-f-]{36}$/);
    const id = page.url().split("/p/")[1];
    const build = page.getByRole("button", { name: /^Build · ~\d+ credits$/ });
    await expect(build).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Stack: Node\.js \(Express\), React 18 \(Vite\) and Python \(CrewAI\), kept from your repo/)).toBeVisible();

    // A question the server says blocks Build: answer it with its first option, whatever the model called it.
    const { data: bp } = await db.from("blueprints").select("id").eq("project_id", id).single();
    const { data: blocking } = await db.from("questions").select("text").eq("blueprint_id", bp!.id).eq("blocking", true);
    for (const q of blocking ?? []) {
      await page.locator("section").filter({ has: page.getByRole("heading", { name: q.text }) }).first().getByRole("button").first().click();
    }
    await expect(build).not.toHaveAttribute("aria-disabled", "true", { timeout: 15_000 });

    // Build (fast), then the build's pull request.
    await page.goto(`/p/${id}?sim=fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    const chat = page.getByRole("complementary", { name: "Chat" });
    const pr = chat.getByRole("region", { name: "Pull request #12" });
    await expect(pr).toBeVisible({ timeout: 60_000 });
    await expect(pr).toContainText("PR #12 · Build:");
    await expect(pr).toContainText("→ main on netanyaj/ticket-triage");
    await expect(pr.getByText(/^Test: /).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Launch/ }).first()).toBeVisible({ timeout: 150_000 });

    const { data: prs } = await db.from("pull_requests").select("number, branch, parts").eq("project_id", id);
    expect(prs).toHaveLength(1);
    expect(prs![0].branch).toBe("architect/ticket-triage-v1");
    expect((prs![0].parts as unknown[]).length).toBeGreaterThan(0);
    // Parts the repo already did (proved by its tests) weren't rebuilt: they aren't in the PR.
    const { data: works } = await db.from("items").select("key, status_detail").eq("project_id", id).like("status_detail", "Works today%");
    const inPr = new Set((prs![0].parts as { key: string }[]).map((p) => p.key));
    for (const w of works ?? []) expect(inPr.has(w.key)).toBe(false);
  });
});
