import { expect, test } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* M6: the landing page, and MCP servers in Connections (PRD BL-9) with a real Test connection against a public MCP
   server (DeepWiki's, no auth). */

test.describe("M6: landing page and MCP servers", () => {
  test.setTimeout(120_000);
  let user: TestUser;
  test.beforeAll(async () => {
    user = await createTestUser("mcp");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });

  test("signed out, / is the landing page with Try the demo and Sign in; signed in, it goes to Home", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Describe an agentic app");
    await expect(page.getByRole("button", { name: "Try the demo" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    for (const proof of ["Plan and cost before build", "Proof per part", "Launch through your company's rules"]) await expect(page.getByText(proof)).toBeVisible();
    await signIn(page, user);
    await page.goto("/");
    await page.waitForURL(/\/home$/);
  });

  test("add an MCP server (governance off): a real Test connection lists its tools, and refuses private addresses", async ({ page }) => {
    await signIn(page, user);
    const db = adminDb();
    // Personal: governance off, so any HTTPS server can be added by a Builder or above.
    const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("workspaces.kind", "personal").single();
    await page.context().addCookies([{ name: "ax_ws", value: m!.workspace_id, domain: new URL(page.url()).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
    await page.goto("/connections");
    const section = page.getByRole("region", { name: "MCP servers" });
    await section.getByRole("button", { name: "Add an MCP server" }).click();
    await section.getByLabel("Name").fill("Local");
    await section.getByLabel("URL").fill("https://127.0.0.1/mcp");
    await section.getByRole("button", { name: "Add and test" }).click();
    await expect(section.getByRole("alert")).toHaveText("That address is private or local, so Architect won't call it.");
    await section.getByLabel("Name").fill("DeepWiki");
    await section.getByLabel("URL").fill("https://mcp.deepwiki.com/mcp");
    await section.getByRole("button", { name: "Add and test" }).click();
    await expect(section.getByText(/Connected · \d+ tools/)).toBeVisible({ timeout: 30_000 });
    await expect(section.getByRole("list", { name: "DeepWiki tools" })).toContainText("read_wiki_structure");
    const { data: audit } = await db.from("audit_log").select("action").eq("workspace_id", m!.workspace_id).like("action", "mcp.%");
    expect(audit!.map((a) => a.action).sort()).toEqual(["mcp.added", "mcp.tested"]);
  });
});
