import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Hand-off (F8): Morgan offers Meeting Prep to a teammate who hasn't joined yet; the teammate accepts with their
   invite link and sees "You now own Meeting Prep" with the note. Then a member with an account accepts in the
   project, and the history is in Project settings. */

test.describe("M4: Hand-off", () => {
  test.setTimeout(180_000);
  let morgan: TestUser;
  let sam: TestUser;

  test.beforeAll(async () => {
    morgan = await createTestUser("morgan");
    sam = await createTestUser("samuel");
  });
  test.afterAll(async () => {
    for (const u of [morgan, sam]) if (u) await deleteTestUser(u);
  });

  test("Morgan hands Meeting Prep to a teammate, who accepts with their invite link and sees what they now own", async ({ browser }) => {
    const db = adminDb();
    // Morgan invites the teammate as a Builder.
    const morganPage = await (await browser.newContext()).newPage();
    await signIn(morganPage, morgan);
    await morganPage.goto("/settings");
    await morganPage.getByLabel("Email", { exact: true }).fill(sam.email);
    await morganPage.getByLabel("Role", { exact: true }).selectOption("builder");
    await morganPage.getByRole("button", { name: "Create invite link" }).click();
    const link = await morganPage.getByRole("status").getByLabel("Invite link").inputValue();

    // ⋯ › Transfer ownership, to the invited teammate, with a note.
    const { data: m } = await db.from("members").select("workspace_id").eq("user_id", morgan.id).eq("role", "owner").single();
    const { data: p } = await db.from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", "Meeting Prep").single();
    await morganPage.goto(`/p/${p!.id}`);
    await morganPage.getByRole("button", { name: "More for this project" }).click();
    await morganPage.getByRole("menuitem", { name: "Transfer ownership…" }).click();
    const dialog = morganPage.getByRole("dialog", { name: "Transfer ownership of Meeting Prep" });
    await dialog.getByLabel("New owner").selectOption({ label: `${sam.email} (invited)` });
    await expect(dialog).toContainText("The hand-off completes when they accept their invite link.");
    await dialog.getByLabel("Note for them (optional)").fill("Briefs go to #sales-team. Gmail still needs connecting.");
    await dialog.getByRole("button", { name: "Offer ownership" }).click();
    await expect(morganPage.getByRole("region", { name: "Ownership offer sent" })).toContainText(`Waiting for ${sam.email} to accept ownership.`);
    expect((await db.from("projects").select("owner_id").eq("id", p!.id).single()).data!.owner_id).toBe(morgan.id);

    // The teammate accepts the invite link: the hand-off completes.
    const samPage = await (await browser.newContext()).newPage();
    await signIn(samPage, sam);
    await samPage.goto(link);
    await samPage.getByRole("button", { name: "Accept and join" }).click();
    await samPage.waitForURL(/\/home$/);
    expect((await db.from("projects").select("owner_id").eq("id", p!.id).single()).data!.owner_id).toBe(sam.id);

    await samPage.goto(`/p/${p!.id}`);
    const owned = samPage.getByRole("region", { name: "You now own this project" });
    await expect(owned).toContainText("You now own Meeting Prep");
    await expect(owned).toContainText("From Morgan Tester.");
    await expect(owned).toContainText("“Briefs go to #sales-team. Gmail still needs connecting.”");
    await expect(owned).toContainText(/v1 · \d+ parts/);
    await expect(owned).toContainText(/\d+ of \d+ parts work/);
    await expect(owned.getByRole("button", { name: "Open full plan" })).toBeVisible();
    await owned.getByRole("button", { name: "Got it" }).click();
    await expect(owned).toHaveCount(0);
    await samPage.reload();
    await expect(samPage.getByRole("region", { name: "You now own this project" })).toHaveCount(0);

    // A member with an account accepts in the project: Sam hands it back to Morgan.
    await samPage.getByRole("button", { name: "More for this project" }).click();
    await samPage.getByRole("menuitem", { name: "Transfer ownership…" }).click();
    const back = samPage.getByRole("dialog", { name: "Transfer ownership of Meeting Prep" });
    await back.getByLabel("New owner").selectOption({ label: "Morgan Tester" });
    await back.getByRole("button", { name: "Offer ownership" }).click();
    await morganPage.goto(`/p/${p!.id}`);
    const offer = morganPage.getByRole("region", { name: "Ownership offer" });
    await expect(offer).toContainText("Samuel Tester wants to hand you Meeting Prep");
    await offer.getByRole("button", { name: "Accept ownership" }).click();
    await expect(morganPage.getByRole("region", { name: "You now own this project" })).toContainText("From Samuel Tester.");
    expect((await db.from("projects").select("owner_id").eq("id", p!.id).single()).data!.owner_id).toBe(morgan.id);

    // Ownership history in Project settings.
    await morganPage.goto(`/p/${p!.id}/settings`);
    const history = morganPage.getByRole("list", { name: "Ownership history" });
    await expect(history.getByRole("listitem")).toHaveCount(2);
    await expect(history.getByRole("listitem").nth(0)).toContainText("Samuel Tester → Morgan Tester");
    await expect(history.getByRole("listitem").nth(1)).toContainText("Morgan Tester → Samuel Tester");
  });
});
