"use server";

import { z } from "zod";
import { ask, GatewayRateLimited, GatewaySlow } from "@/lib/gateway";
import type { Json } from "@/lib/database.types";
import { createAdminDb } from "../db";
import { listProjects } from "../queries";
import { SUPPORT_INSTRUCTIONS } from "../support-faq";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

const turn = z.object({ role: z.enum(["user", "bot"]), text: z.string().max(2000) });
const askSchema = z.object({
  question: z.string().trim().min(1, "Type a question first.").max(500, "Keep it under 500 characters."),
  history: z.array(turn).max(20).default([]),
});

/** The workspace facts the bot may use: project states only, no personal data. */
async function workspaceFacts() {
  const ctx = await getAppContext();
  const projects = await listProjects(ctx);
  const lines = projects.map((p) => `- ${p.name}: ${p.summary.meta}. Next: ${p.summary.next.text}.${p.budgetCredits ? ` Budget ${p.budgetCredits} credits, ${p.creditsUsed} used.` : ""}`);
  return `Workspace "${ctx.workspace.name}". The person is ${/^[aeiou]/.test(ctx.role) ? "an" : "a"} ${ctx.role}.\nProjects:\n${lines.join("\n") || "- none yet"}`;
}

/** Help bot: answers from the FAQ through the model gateway (real Gemini). */
export async function askSupport(input: { question: string; history?: { role: "user" | "bot"; text: string }[] }): Promise<
  ActionResult<{ answer: string }> & { rateLimited?: boolean }
> {
  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { question, history } = parsed.data;
  const convo = history
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Person" : "Help"}: ${t.text}`)
    .join("\n");
  try {
    const { text } = await ask({
      instructions: `${SUPPORT_INSTRUCTIONS}\n\nWORKSPACE FACTS:\n${await workspaceFacts()}`,
      prompt: `${convo ? `Conversation so far:\n${convo}\n\n` : ""}Person: ${question}`,
      maxOutputTokens: 400,
      fast: true,
    });
    if (!text) return { ok: false, message: "I couldn't come up with an answer. Try asking another way, or talk to a person." };
    return { ok: true, answer: text };
  } catch (err) {
    if (err instanceof GatewayRateLimited || err instanceof GatewaySlow) {
      const why = err instanceof GatewayRateLimited && err.reason === "demand" ? "high demand" : err instanceof GatewaySlow ? "it took too long" : "the free model's limit";
      return { ok: false, rateLimited: true, message: `Help is busy right now (${why}). Try again in a minute, or talk to a person.` };
    }
    return { ok: false, message: "Help can't answer right now. Try again in a moment, or talk to a person." };
  }
}

/**
 * "Talk to a person": saves a ticket with the conversation and returns its number.
 * SIMULATED in this prototype (BUILD-SPEC section 1): the ticket is real, but nobody is staffing tickets and no email is sent.
 */
export async function createSupportTicket(input: {
  question?: string;
  transcript?: { role: "user" | "bot"; text: string }[];
  projectId?: string | null;
}): Promise<ActionResult<{ ticketId: number }>> {
  const ctx = await getAppContext();
  const transcript = z.array(turn).max(40).safeParse(input.transcript ?? []);
  const projectId = input.projectId && z.string().uuid().safeParse(input.projectId).success ? input.projectId : null;
  const question = (input.question ?? "").trim().slice(0, 500) || "Asked for a person from Help";

  const admin = createAdminDb();
  // Only link a project the person can see in this workspace.
  let linked: string | null = null;
  if (projectId) {
    const { data } = await admin.from("projects").select("id").eq("id", projectId).eq("workspace_id", ctx.workspace.id).maybeSingle();
    linked = data?.id ?? null;
  }
  const { data, error } = await admin
    .from("support_tickets")
    .insert({
      user_id: ctx.user.id,
      workspace_id: ctx.workspace.id,
      project_id: linked,
      question,
      transcript: (transcript.success ? transcript.data : []) as Json,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "The ticket couldn't be saved. Try again in a moment." };
  return { ok: true, ticketId: Number(data.id) };
}
