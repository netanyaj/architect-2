"use server";

import { z } from "zod";
import { askObject, GatewayRateLimited, GatewaySlow } from "@/lib/gateway";
import { PROVIDERS } from "@/lib/providers";
import { allowedModels } from "../blueprint/write-plan";
import { createAdminDb } from "../db";
import { loadPolicies } from "../policy";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/* Help me decide (BL-2, screen 14): the AI Consultant. Three answers in, three ideas out, through the gateway (real).
   An idea is only a starting prompt: its plan, parts and cost come from the plan writer, and nothing is built until
   the person clicks Build. The model writes the ideas; the server keeps the tools to ones Architect knows. */

export type Idea = { title: string; line: string; tools: string[]; hoursSaved: number; prompt: string };

const answers = z.object({
  role: z.string().trim().min(2, "Say what you do, in a few words.").max(80),
  timeSink: z.string().trim().min(3, "Say what takes your time.").max(300),
  tools: z.array(z.string()).max(12),
  avoid: z.array(z.string().max(80)).max(9).optional(),
});

const IdeaOut = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().describe("A short name for the app, 2 to 5 words, sentence case"),
        line: z.string().describe("One sentence: what it does and when, in plain words"),
        tools: z.array(z.string()).describe("Which of the person's tools it uses, by their ids"),
        hours_saved: z.number().describe("Hours a week it would save this person, a cautious estimate"),
        prompt: z.string().describe("The request to give Architect, in the person's voice, one to three sentences"),
      }),
    )
    .describe("Exactly three ideas"),
});

const INSTRUCTIONS = `You are Architect's consultant. Suggest three small apps this person could build in Architect, each of which
removes a weekly chore they named. Each idea uses only the tools they listed (by id), runs on its own (a schedule or a
trigger), and fits in 4 to 10 parts. Write plainly: no jargon, no "AI-powered", no exclamation marks. The prompt is what
they'd type into Architect: concrete about inputs, output and when it runs. Never repeat an idea they've already seen.`;

export async function suggestIdeas(raw: z.input<typeof answers>): Promise<ActionResult<{ ideas: Idea[]; simulated: boolean; model: string }>> {
  const ctx = await getAppContext();
  const parsed = answers.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Answer the three questions first." };
  const admin = createAdminDb();
  // Gemini when the workspace allows it, else Architect's model (C-2): never a model the policy disallows.
  const allowed = await allowedModels(admin, ctx.workspace.id);
  const model = allowed.includes("gemini") ? "gemini" : (await loadPolicies(admin, ctx.workspace.id)).models.architect;
  const known = Object.keys(PROVIDERS);
  const tools = parsed.data.tools.filter((t) => known.includes(t));
  const prompt = [
    `Role: ${parsed.data.role}`,
    `What takes their time every week: ${parsed.data.timeSink}`,
    `Their tools (ids): ${tools.length ? tools.join(", ") : "none named; prefer ideas without outside apps"}`,
    parsed.data.avoid?.length ? `Ideas they've already seen (suggest different ones): ${parsed.data.avoid.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  try {
    const { object, label, simulated } = await askObject({ instructions: INSTRUCTIONS, prompt, schema: IdeaOut, model, fast: true });
    const ideas = object.ideas
      .slice(0, 3)
      .map((i) => ({
        title: i.title.trim().slice(0, 60),
        line: i.line.trim().slice(0, 200),
        tools: [...new Set(i.tools.filter((t) => tools.includes(t)))],
        hoursSaved: Math.min(20, Math.max(0.5, Math.round(i.hours_saved * 2) / 2)),
        prompt: i.prompt.trim().slice(0, 1200),
      }))
      .filter((i) => i.title && i.prompt);
    if (ideas.length < 3) return { ok: false, message: "The ideas didn't come back complete. Try again." };
    return { ok: true, ideas, simulated, model: label };
  } catch (err) {
    if (err instanceof GatewayRateLimited || err instanceof GatewaySlow) return { ok: false, message: "The model is busy right now. Try again in a minute. Your answers are kept." };
    return { ok: false, message: "The model didn't answer. Try again. Your answers are kept." };
  }
}
