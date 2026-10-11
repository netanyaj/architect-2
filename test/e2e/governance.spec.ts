import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./build.spec.seed";
import { adminDb, createTestUser, deleteTestUser, type TestUser } from "./helpers";

/* Governance policies (C-1 to C-3), master–detail like screen 11, and each one's effect where builders work:
   where it runs on Launch, allowed models in pickers ("This model is no longer allowed · Switch", never switched
   silently), the private model, allowed MCP servers in agent tools, and who may connect apps. */

const policy = (page: Page) => page.getByRole("region", { name: "Policy", exact: true });
const policies = (page: Page) => page.getByRole("region", { name: "Policies", exact: true });

test.describe("Governance policies", () => {
  test.setTimeout(150_000);
  let user: TestUser;
  let workspace: string;
  const project = async (name: string) => (await adminDb().from("projects").select("id").eq("workspace_id", workspace).eq("name", name).single()).data!.id;

  test.beforeAll(async () => {
    user = await createTestUser("policies");
  });
  test.afterAll(async () => {
    if (user) await deleteTestUser(user);
  });
  async function signInAndFind(page: Page) {
    await signIn(page, user);
    const { data: m } = await adminDb().from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    workspace = m!.workspace_id;
  }

  test("where it runs: a VPC in your AWS account, the picture, and Launch says where the app runs", async ({ page }) => {
    await signInAndFind(page);
    await page.goto("/governance");
    await expect(policies(page).getByRole("button", { name: /Where it runs.*Lyzr Cloud/ })).toBeVisible();
    await expect(policy(page).getByRole("radio", { name: /On-prem or air-gapped/ })).toBeDisabled();
    await policy(page).getByRole("radio", { name: /Your AWS account \(VPC\)/ }).check();
    await policy(page).getByLabel("AWS region").selectOption("eu-west-1");
    const picture = policy(page).getByRole("figure", { name: "Where each part runs" });
    await expect(picture).toContainText("Your AWS account · VPC in eu-west-1");
    await expect(picture).toContainText("Lyzr control plane");
    await expect(picture).toContainText("Model providers' APIs");
    await policy(page).getByRole("button", { name: "Save where it runs" }).click();
    await expect(policy(page).getByRole("status")).toContainText("Saved.");
    await expect(policies(page).getByRole("button", { name: /Where it runs.*Your AWS VPC · eu-west-1/ })).toBeVisible();
    await expect.poll(async () => (await adminDb().from("audit_log").select("target").eq("workspace_id", workspace).eq("action", "policy.changed")).data?.map((r) => r.target)).toContain("Where it runs: Your AWS VPC · eu-west-1");

    await page.goto(`/p/${await project("Meeting Prep")}/launch`);
    await expect(page.getByText("Runs in Your AWS VPC · eu-west-1 · your organisation's choice")).toBeVisible();
  });

  test("models: a private model for Architect; a disallowed model says so and is switched only by the person", async ({ page }) => {
    await signInAndFind(page);
    await page.goto("/governance?section=models");
    await policy(page).getByLabel("Name").fill("Acme Llama 3.1");
    await policy(page).getByLabel("Endpoint (https)").fill("https://llm.acme.internal/v1");
    await policy(page).getByRole("button", { name: "Register model" }).click();
    await expect(policy(page).getByRole("status")).toContainText("Registered Acme Llama 3.1.");
    // Architect's model becomes the private one, and Claude is no longer allowed.
    await policy(page).getByLabel(/^Architect's model/).selectOption("private");
    await policy(page).getByRole("checkbox", { name: /^Claude Sonnet/ }).uncheck();
    await policy(page).getByRole("button", { name: "Save models" }).click();
    await expect(policy(page).getByRole("status")).toContainText("Saved.");

    // Home starts new projects on Auto (M5.8), which uses Architect's model; the private one is listed, Simulated.
    await page.goto("/home");
    const homePicker = page.getByRole("button", { name: /^Model: Auto/ });
    await expect(homePicker).toHaveAttribute("title", /every step uses Acme Llama 3\.1/);
    await homePicker.click();
    await expect(page.getByRole("menuitem", { name: /^Acme Llama 3\.1/ })).toContainText("Simulated");
    await page.keyboard.press("Escape");

    // Meeting Prep was on Claude: chat says so and doesn't switch it; Switch opens the picker.
    const id = await project("Meeting Prep");
    await page.goto(`/p/${id}`);
    const chat = page.getByRole("complementary", { name: "Chat" });
    await expect(chat.getByText("This model is no longer allowed ·")).toBeVisible();
    expect((await adminDb().from("projects").select("model").eq("id", id).single()).data!.model).toMatch(/^claude/);
    await chat.getByRole("button", { name: "Switch" }).click();
    // Blocked models stay in the list, disabled, with the reason (M5.8).
    await expect(page.getByRole("menuitem", { name: /Claude/ })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("menuitem", { name: /Claude/ })).toContainText("Blocked by your workspace");
    await page.getByRole("menuitem", { name: /^Gemini/ }).click();
    await page.getByRole("dialog", { name: "Switch this project to Gemini?" }).getByRole("button", { name: "Switch to Gemini" }).click();
    await expect.poll(async () => (await adminDb().from("projects").select("model").eq("id", id).single()).data!.model).toBe("gemini");
    await expect(chat.getByText("This model is no longer allowed ·")).toHaveCount(0, { timeout: 30_000 });

    // The agent on Claude says so too; the line under the picker says what Studio runs (M5.10).
    await page.goto(`/p/${id}?view=agents`);
    await page.getByRole("group", { name: "How the agents connect" }).getByRole("button", { name: "Brief writer: open its settings" }).click();
    const settings = page.getByRole("complementary", { name: "Brief writer settings" });
    await expect(settings.getByText(/In Lyzr Studio it runs on Gemini 3\.1 Flash Lite, Lyzr's built-in model/)).toBeVisible();
    await expect(settings.getByText("This model is no longer allowed ·")).toBeVisible();
  });

  test("apps: admins-only connecting, an allowed MCP server in agent tools, and Builders see the reason", async ({ page }) => {
    await signInAndFind(page);
    await page.goto("/governance?section=apps");
    await policy(page).getByRole("radio", { name: /Owners and Admins only/ }).check();
    await policy(page).getByLabel("What Gmail may do").selectOption("read");
    await policy(page).getByRole("button", { name: "Save apps" }).click();
    await expect(policy(page).getByRole("status")).toContainText("Saved.");
    await policy(page).getByLabel("Name").fill("Acme CRM tools");
    await policy(page).getByLabel("URL (https)").fill("https://mcp.acme.internal");
    await policy(page).getByRole("button", { name: "Add server" }).click();
    await expect(policy(page).getByRole("list", { name: "Allowed MCP servers" })).toContainText("Acme CRM tools");

    // Agent tools offer the allowed server.
    const tt = await project("ticket-triage");
    await page.goto(`/p/${tt}?view=agents`);
    await page.getByRole("group", { name: "How the agents connect" }).getByRole("button", { name: "Urgency and team label: open its settings" }).click();
    const settings = page.getByRole("complementary", { name: "Urgency and team label settings" });
    await expect(settings.getByText("MCP servers your organisation allows: Acme CRM tools.")).toBeVisible();
    await settings.getByRole("button", { name: "Tool or MCP server" }).click();
    await expect(page.getByRole("menuitem", { name: "MCP: Acme CRM tools" })).toBeVisible();
    await page.keyboard.press("Escape");

    // As a Builder: Connections says only Owners and Admins connect apps here, and Gmail is read only.
    const db = adminDb();
    await db.from("members").update({ role: "builder" }).eq("workspace_id", workspace).eq("user_id", user.id);
    try {
      await page.goto("/connections");
      const gmail = page.getByRole("list", { name: "Connections" }).getByRole("listitem").filter({ hasText: "Gmail" });
      await expect(gmail).toContainText("Allowed: read only.");
      await expect(gmail).toContainText("Your admin's rule: only Owners and Admins connect apps in this workspace.");
      await expect(gmail.getByRole("button", { name: "Connect Gmail" })).toHaveAttribute("aria-disabled", "true");
      await page.goto("/governance");
      await expect(page.getByText(/could not be found|not found/i).first()).toBeVisible();
    } finally {
      await db.from("members").update({ role: "owner" }).eq("workspace_id", workspace).eq("user_id", user.id);
    }
  });
});
