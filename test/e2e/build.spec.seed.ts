import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminDb, type TestUser } from "./helpers";

import type { Page } from "@playwright/test";

const plan = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "blueprints", "meeting-prep.gemini.json"), "utf8")) as {
  name: string;
  summary: string;
  items: { key: string; grp: string; title: string; description: string; proved_when: string; source_quote: string; item_class: string; size: string; provider?: string | null }[];
};

export async function signIn(page: Page, user: TestUser) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/home$/);
}

/** A written, unagreed plan in the person's workspace, as if the model had just written it. */
export async function seedPlan(user: TestUser, name: string): Promise<string> {
  const db = adminDb();
  const { data: m } = await db.from("members").select("workspace_id").eq("user_id", user.id).eq("role", "owner").single();
  const { data: project } = await db
    .from("projects")
    .insert({ workspace_id: m!.workspace_id, name, owner_id: user.id, status: "draft", model: "gemini", prompt: "Meeting prep briefs", current_version: 1 })
    .select("id")
    .single();
  const total = plan.items.length * 10;
  const { data: bp } = await db
    .from("blueprints")
    .insert({ project_id: project!.id, version: 1, prompt: "Meeting prep briefs", generation: "ready", name, summary: plan.summary, total_likely: total, total_low: total - 10, total_high: total + 10, model: "gemini" })
    .select("id")
    .single();
  await db.from("items").insert(
    plan.items.map((i, position) => ({
      blueprint_id: bp!.id,
      project_id: project!.id,
      key: i.key,
      grp: i.grp,
      title: i.title,
      description: i.description,
      proved_when: i.key === "talking-points-generator" ? "Done when briefs stay under 200 words and name every attendee." : i.proved_when,
      source_quote: i.source_quote,
      item_class: i.item_class,
      size: i.size,
      provider: i.provider ?? null,
      estimate_likely: 10,
      estimate_low: 8,
      estimate_high: 12,
      position,
    })),
  );
  return project!.id;
}

