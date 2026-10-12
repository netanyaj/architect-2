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
    // The credit line, on the landing page only.
    const credit = page.locator("footer");
    await expect(credit).toHaveText("Built by Netanya Jaison as a prototype for Lyzr's Architect · not an official Lyzr product · GitHub");
    await expect(credit.getByRole("link", { name: "GitHub" })).toHaveAttribute("href", "https://github.com/netanyaj/architect-2");
    await signIn(page, user);
    await page.goto("/");
    await page.waitForURL(/\/home$/);
    await expect(page.getByText("Built by Netanya")).toHaveCount(0);
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

  test("governance off (Personal): a Builder adds an MCP server and an API-key app; an Owner adds the Lyzr key", async ({ browser }) => {
    const db = adminDb();
    const builder = await createTestUser("builder");
    try {
      const { data: m } = await db.from("members").select("workspace_id, workspaces!inner(kind, governance_enabled)").eq("user_id", user.id).eq("workspaces.kind", "personal").single();
      const ws = m!.workspace_id;
      expect((m!.workspaces as unknown as { governance_enabled: boolean }).governance_enabled).toBe(false);
      await db.from("members").insert({ workspace_id: ws, user_id: builder.id, role: "builder", status: "active" });
      const open = async (who: TestUser) => {
        const page = await (await browser.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
        await signIn(page, who);
        await page.context().addCookies([{ name: "ax_ws", value: ws, domain: new URL(page.url()).hostname, path: "/", httpOnly: true, sameSite: "Lax" }]);
        await page.goto("/connections");
        return page;
      };

      // The Builder: any HTTPS MCP server, and any API-key app; the Lyzr key is for Owners and Admins.
      const b = await open(builder);
      const mcp = b.getByRole("region", { name: "MCP servers" });
      await mcp.getByRole("button", { name: "Add an MCP server" }).click();
      await mcp.getByLabel("Name").fill("Context7");
      await mcp.getByLabel("URL").fill("https://mcp.context7.com/mcp");
      await mcp.getByRole("button", { name: "Add and test" }).click();
      await expect(mcp.getByText(/Connected · \d+ tools/)).toBeVisible({ timeout: 30_000 });
      await b.getByRole("button", { name: "Add an API key" }).click();
      await b.getByLabel("Service").fill("Clearbit");
      await b.getByLabel("API key", { exact: true }).fill("sk_test_clearbit_0000");
      await b.getByRole("button", { name: "Save key" }).click();
      await expect(b.getByText(/Set by Builder Tester/)).toBeVisible();
      await expect(b.getByText("An Owner or Admin connects the workspace's Lyzr key.")).toBeVisible();
      await b.screenshot({ path: "docs/qa/governance-off-builder-connections.png", fullPage: true });

      // The Owner: the Lyzr key, checked with Lyzr.
      const o = await open(user);
      await o.getByLabel("Lyzr API key").fill(process.env.LYZR_API_KEY!);
      await o.getByRole("button", { name: "Connect with your Lyzr API key" }).click();
      await expect(o.locator("#lyzr").getByText("Connected", { exact: true })).toBeVisible({ timeout: 30_000 });
      // The key's last characters are blurred in the saved screenshot, since the repo will be public.
      await o.screenshot({ path: "docs/qa/governance-off-owner-connections.png", fullPage: true, style: "#lyzr .font-mono { filter: blur(6px); }" });

      const { data: audit } = await db.from("audit_log").select("action").eq("workspace_id", ws);
      expect(audit!.map((a) => a.action)).toEqual(expect.arrayContaining(["mcp.added", "connection.api_key_set"]));
    } finally {
      await deleteTestUser(builder);
    }
  });
});
