import { expect, test, type Page } from "@playwright/test";
import { seedPlan, signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Editable files in Developer view (simulated): Edit, then "Which part does this edit belong to?" with a suggestion,
   a card "Code edit to … · re-runs the check for …", the part's check running again until it passes, and on a project
   from a repo the edit on its pull request. */

const files = (page: Page) => page.getByRole("complementary", { name: "Files" });
const viewer = (page: Page) => page.getByRole("region", { name: "Viewer" });

test.describe("Code edits in Developer view", () => {
  test.setTimeout(200_000);
  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser("editor");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("edit a part's file: pick the part (suggested), its check runs again and passes, and the edit is on the PR", async ({ page }) => {
    await signIn(page, user);
    const db = adminDb();
    const id = await seedPlan(user, "Edit Prep");
    // A project from a repo, so the build opens a pull request and the edit goes on it.
    await db.from("projects").update({ repo_full_name: "netanyaj/ticket-triage" }).eq("id", id);
    await page.goto(`/p/${id}?sim=fast`);
    await page.getByRole("button", { name: /^Build · ~\d+ credits$/ }).click();
    await expect(page.getByRole("link", { name: "Launch", exact: true })).toBeVisible({ timeout: 120_000 });

    await page.goto(`/p/${id}?dev=1`);
    const group = files(page).getByRole("region", { name: /^Talking points generator · new/ });
    await group.getByRole("button", { name: /agents\/talking-points-generator\.py/ }).click();
    await viewer(page).getByRole("button", { name: "Edit" }).click();
    const box = viewer(page).getByLabel("Edit agents/talking-points-generator.py");
    await box.fill(`${await box.inputValue()}\n# Keep each talking point under 25 words.`);
    await viewer(page).getByRole("button", { name: "Save edit…" }).click();

    const dialog = page.getByRole("dialog", { name: "Which part does this edit belong to?" });
    await expect(dialog.getByRole("radio", { name: /Talking points generator/ })).toBeChecked();
    await expect(dialog.getByText("Suggested")).toBeVisible();
    await dialog.getByRole("button", { name: "Save to Talking points generator" }).click();
    await expect(viewer(page).getByRole("status")).toContainText("Saved. Talking points generator's check is running again. The edit is on PR #12.");

    // The card in Activity, and the change under its part.
    const card = page.getByRole("region", { name: "Code edit to agents/talking-points-generator.py" }).first();
    await expect(card).toContainText("re-runs the check for Talking points generator", { timeout: 30_000 });
    await expect(card).toContainText("on PR #12");
    await expect(files(page).getByRole("region", { name: /^Talking points generator · .*edited$/ })).toBeVisible();
    // The check passes again (simulated, a few seconds), and only then does the part work.
    await expect(card).toContainText("Talking points generator's check passed again", { timeout: 30_000 });
    const { data: part } = await db.from("items").select("id, status").eq("project_id", id).eq("key", "talking-points-generator").single();
    expect(part!.status).toBe("built");
    const { data: proofs } = await db.from("proofs").select("summary").eq("item_id", part!.id).eq("summary", "Passed again after a code edit to agents/talking-points-generator.py");
    expect(proofs).toHaveLength(1);

    // The pull request lists the edit.
    await page.goto(`/p/${id}`);
    const pr = page.getByRole("complementary", { name: "Chat" }).getByRole("region", { name: "Pull request #12" });
    await expect(pr).toContainText("Code edits");
    await expect(pr).toContainText("agents/talking-points-generator.py · Talking points generator");
  });
});
