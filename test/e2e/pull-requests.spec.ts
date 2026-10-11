import { expect, test } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Changes as PRs (B-4, B-5, Simulated): on a project from a repo, the build and each applied change open a branch
   and a pull request listing their parts; merging (the push to main) needs a click; Live deploys from main after it;
   ?sim=sync shows commits on main from outside Architect. */

test.describe("M4: Changes as pull requests", () => {
  test.setTimeout(240_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("puller");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("build and an applied change each open a PR with their parts; merge needs a click; sync banner", async ({ page }) => {
    await signIn(page, user);
    const id = await seedPlan(user, "Repo Prep");
    const db = adminDb();
    await db.from("projects").update({ repo_full_name: "netanyaj/ticket-triage", stack: "Node.js (Express), React 18 (Vite) and Python (CrewAI)" }).eq("id", id);

    await page.goto(`/p/${id}?sim=fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    await expect(page.getByRole("link", { name: "Launch", exact: true })).toBeVisible({ timeout: 120_000 });
    const chat = page.getByRole("complementary", { name: "Chat" });
    const first = chat.getByRole("region", { name: "Pull request #12" });
    await expect(first).toContainText("PR #12 · Build:");
    await expect(first).toContainText("architect/repo-prep-v1 → main on netanyaj/ticket-triage");
    await expect(first).toContainText("Talking points generator");
    await expect(first).toContainText("Test:");

    // The build has settled (only one run at a time), then a change, applied: its own branch and PR, listing only the part it adds.
    await expect.poll(async () => (await db.from("runs").select("status").eq("project_id", id).single()).data!.status, { timeout: 60_000 }).not.toBe("running");
    const { data: msg } = await db.from("messages").insert({ project_id: id, role: "architect", mode: "build", content: "I'll add a Friday recap." }).select("id").single();
    await db.from("change_proposals").insert({
      project_id: id,
      message_id: msg!.id,
      reply: "I'll add a Friday recap.",
      estimate_likely: 9,
      est_minutes: 1,
      status: "proposed",
      diff: {
        add: [{ key: "friday-recap", grp: "features", title: "Friday recap of the week's meetings", description: "A short recap every Friday.", proved_when: "Done when a recap arrives every Friday at 16:00", source_quote: "", item_class: "screen.list", size: "s" }],
        change: [],
        remove: [],
        base_version: 1,
      },
    });
    await page.goto(`/p/${id}?sim=fast`);
    await chat.getByRole("button", { name: "Apply" }).click();
    await expect(chat.getByText("Applied as plan v2. Building the change now.")).toBeVisible();
    const pr = chat.getByRole("region", { name: "Pull request #13" });
    await expect(pr).toBeVisible({ timeout: 30_000 });
    await expect(pr).toContainText("PR #13 · Change: Friday recap of the week's meetings");
    await expect(pr).toContainText("architect/repo-prep-v2 → main");
    await expect(pr).toContainText("Test: Done when a recap arrives every Friday at 16:00");
    await expect(pr).not.toContainText("Talking points generator");
    await expect(pr).toContainText("Ready to merge", { timeout: 90_000 });
    expect((await db.from("pull_requests").select("number, status").eq("project_id", id).order("number")).data).toEqual([
      { number: 12, status: "open" },
      { number: 13, status: "open" },
    ]);

    // Launch: the team version builds from the PR branch; Live deploys from main after the merge.
    await page.goto(`/p/${id}/launch`);
    await expect(page.getByText("Builds from the PR branch architect/repo-prep-v2 (PR #13)")).toBeVisible();
    await expect(page.getByText("Deploys from main after PR #13 merges")).toBeVisible();

    // Merging is the push to main: it waits for the click and a confirmation.
    await page.goto(`/p/${id}`);
    await pr.getByRole("button", { name: "Merge into main" }).click();
    const confirm = page.getByRole("dialog", { name: "Merge PR #13 into main?" });
    await expect(confirm).toContainText("This pushes architect/repo-prep-v2 to main on netanyaj/ticket-triage.");
    await confirm.getByRole("button", { name: "Merge into main" }).click();
    await expect(pr).toContainText("Merged · merged by you");
    expect((await db.from("pull_requests").select("status").eq("project_id", id).eq("number", 13).single()).data!.status).toBe("merged");
    await page.goto(`/p/${id}/launch`);
    await expect(page.getByText("Deploys from main · PR #13 merged")).toBeVisible();

    // Sync (B-5): commits on main from outside Architect.
    await page.goto(`/p/${id}?sim=sync`);
    const sync = page.getByRole("status", { name: "Sync with main" });
    await expect(sync).toContainText("2 commits on main from outside Architect · checks re-run for 1 part");
    await expect(sync).toContainText("Simulated");
  });

  test("Settings › GitHub: the installation and its repos from GitHub, Manage on GitHub, disconnect", async ({ page }) => {
    await signIn(page, user);
    const db = adminDb();
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    await db.from("github_installations").upsert(
      { workspace_id: m!.workspace_id, installation_id: Number(process.env.E2E_GITHUB_INSTALLATION ?? 167616247), account_login: "netanyaj", account_type: "User", added_by: user.id },
      { onConflict: "workspace_id,installation_id" },
    );
    await page.goto("/settings");
    const panel = page.getByRole("region", { name: "GitHub" });
    const accounts = panel.getByRole("list", { name: "GitHub accounts" });
    await expect(accounts).toContainText("netanyaj");
    await expect(panel.getByRole("list", { name: "Repos netanyaj shares" })).toContainText("netanyaj/ticket-triage", { timeout: 30_000 });
    await expect(panel.getByRole("link", { name: "Manage on GitHub" })).toHaveAttribute("href", /^https:\/\/github\.com\/settings\/installations\/\d+$/);
    await expect(panel.getByRole("link", { name: "Install on more repos" })).toHaveAttribute("href", /\/installations\/new$/);
    const real = panel.getByRole("switch", { name: "Open real PRs on test repos" });
    await expect(real).toHaveAttribute("aria-checked", "false");
    await expect(real).toHaveAttribute("title", /^Needs Contents: Read and write on the GitHub App/);

    await accounts.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("dialog", { name: "Disconnect netanyaj?" }).getByRole("button", { name: "Disconnect" }).click();
    await expect(panel).toContainText("No GitHub account is connected to this workspace.");
    expect((await db.from("github_installations").select("id").eq("workspace_id", m!.workspace_id)).data).toEqual([]);
  });
});
