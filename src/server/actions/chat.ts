"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { askObject, GatewayRateLimited, GatewaySlow, ask } from "@/lib/gateway";
import { intentByRules, type Intent } from "@/lib/intent";
import { DEFAULT_MODEL, toModelChoice, type ModelChoice } from "@/lib/models";
import { MODEL_NOT_ALLOWED } from "@/lib/policies";
import { canBuild } from "@/lib/permissions";
import { applyDiff, ChangeDraft, conflictsOf, isEmpty, normalizeChange, type Decision, type Diff, type VersionItem } from "@/lib/plan-diff";
import { allowedModels } from "../blueprint/write-plan";
import { createAdminDb, type AdminDb } from "../db";
import { estimate, totals as planTotals } from "../estimate";
import { startRun } from "../sim/run";
import { budgetRefusal } from "../policy";
import { getAppContext } from "../workspace";
import { DARK_THEME_PART } from "@/lib/themes";
import type { ActionResult } from "./members";

const ITEM_FIELDS =
  "key, grp, title, description, proved_when, source_quote, item_class, size, provider, framework, status, status_detail, drop_reason, position, estimate_low, estimate_likely, estimate_high, confidence, est_seconds, cost_driver";

async function projectInWorkspace(admin: AdminDb, projectId: string, workspaceId: string) {
  if (!z.string().uuid().safeParse(projectId).success) return null;
  const { data } = await admin.from("projects").select("id, name, model, prompt, status").eq("id", projectId).eq("workspace_id", workspaceId).maybeSingle();
  return data;
}

async function latestPlan(admin: AdminDb, projectId: string) {
  const { data } = await admin
    .from("blueprints")
    .select("id, version, status, generation, agreed_at, prompt, name, summary, not_in_this_version, model, simulated_model")
    .eq("project_id", projectId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function planContext(name: string, items: VersionItem[], questions: { text: string; answer: string | null; recommended: string }[]) {
  const parts = items.map((i) => `- [${i.key}] (${i.grp}) ${i.title}: done when ${i.proved_when}${i.status === "dropped" ? " (dropped)" : i.status === "deferred" ? " (set aside)" : ""}`);
  const qs = questions.map((q) => `- ${q.text} → ${q.answer ?? `${q.recommended} (default)`}`);
  return `The current plan "${name}":\n${parts.join("\n")}${qs.length ? `\nQuestions:\n${qs.join("\n")}` : ""}`;
}

const ANSWER = `You are Architect, answering a question about a plan for the person who owns it. Discuss, explain and
suggest, but never change the plan and never say you changed it. If they'd like a change, say what you would change and
that they can ask for it in chat to get a change card with its cost. Plain words, sentence case, 1 to 5 short sentences,
no markdown. Never invent costs; the plan's prices come from the system.`;

const CHANGE = `You are Architect. The person asked for something in chat. Turn it into a change to their plan.
- "reply": 1 or 2 plain sentences saying what you'd change (never claim it's done: they still click Apply).
- "add": new parts, written like plan parts: a short plain title, what it does, "proved_when" (one observable condition
  an automatic check can verify), "source_quote" (exact words from their message), a group, an item_class and a size.
- "change": existing parts (by key) whose title, description or proved_when should change. Only what changes.
  Label each with "kind": "weaken" if the part would do less than they first asked or be checked less strictly
  (fewer conditions, a looser number, a narrower scope); otherwise "modify". Be honest: the person must agree to
  any weakening before it applies.
- "remove": existing parts (by key) the request takes away, each with the reason in their words.
- If the message is a question or needs nothing changed, leave add, change and remove empty and answer in "reply".
- Never remove or weaken a part unless they clearly asked for it.
- New parts in "add" are kind add; parts in "remove" are kind remove.
Do not estimate cost or time; the system does that.`;

const INTENT = `Classify one chat message sent to an app builder about the plan for their app.
"question": they want an answer or an explanation, and nothing in the app to change.
"change": they want the app or its plan to be different (add, remove, change, connect, send, schedule…).
"sure" is false when it could reasonably be read either way.`;
const IntentSchema = z.object({ intent: z.enum(["question", "change"]), sure: z.boolean() });

export type ChatResult = ActionResult<{ proposalId?: string; intent?: Intent | "suggestion" }> & { rateLimited?: boolean };

type ChatProject = NonNullable<Awaited<ReturnType<typeof projectInWorkspace>>>;
type ChatPlan = NonNullable<Awaited<ReturnType<typeof latestPlan>>>;

/** Rules first; only what they can't call costs one fast call on the default model (unclear stays unclear). */
async function classify(admin: AdminDb, workspaceId: string, content: string, fallback: ModelChoice): Promise<{ intent: Intent; unclear: boolean }> {
  const byRules = intentByRules(content);
  if (byRules) return { intent: byRules, unclear: false };
  const allowed = await allowedModels(admin, workspaceId);
  const model = allowed.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : fallback;
  try {
    const { object } = await askObject({ instructions: INTENT, prompt: content, schema: IntentSchema, model, fast: true });
    return { intent: object.intent, unclear: !object.sure };
  } catch {
    // The classifier is a convenience: when it can't answer, a change card with "Just answer instead" is the safe
    // default for someone who can build (nothing changes without Apply).
    return { intent: "change", unclear: true };
  }
}

/** The plan as a prompt: its parts and questions, the request and the last few messages. */
async function chatPrompt(admin: AdminDb, project: ChatProject, plan: ChatPlan, content: string, skipLatest: number) {
  const [{ data: items }, { data: questions }, { data: history }] = await Promise.all([
    admin.from("items").select(ITEM_FIELDS).eq("blueprint_id", plan.id).order("position"),
    admin.from("questions").select("text, answer, recommended").eq("blueprint_id", plan.id),
    admin.from("messages").select("role, content").eq("project_id", project.id).order("created_at", { ascending: false }).limit(8 + skipLatest),
  ]);
  const current = (items ?? []) as VersionItem[];
  const context = planContext(plan.name ?? project.name, current, questions ?? []);
  const convo = (history ?? [])
    .slice(skipLatest) // the message just saved
    .reverse()
    .map((m) => `${m.role === "user" ? "Person" : "Architect"}: ${m.content}`)
    .join("\n");
  return { current, prompt: `${context}\n\nOriginal request: ${plan.prompt}\n${convo ? `\nConversation so far:\n${convo}\n` : ""}\nPerson: ${content}` };
}

function busyMessage(err: unknown) {
  return err instanceof GatewaySlow
    ? "The free model took too long, so I stopped it. Your message is saved. Switch model, or try again."
    : err instanceof GatewayRateLimited
      ? "The model is busy right now (the free model's limit), so I couldn't answer. Your message is saved. Switch model, or try again in a minute."
      : "I couldn't reach the model just now. Your message is saved. Try again in a moment.";
}

/** A change card from a request: the diff, its price and any conflicts. Nothing changes until Apply. */
async function proposeChange(
  admin: AdminDb,
  project: ChatProject,
  plan: ChatPlan,
  content: string,
  model: ModelChoice,
  opts: { unclear: boolean; skipLatest: number; say: (text: string, mode: "plan" | "build") => Promise<string | null> },
): Promise<{ proposalId?: string }> {
  const { current, prompt } = await chatPrompt(admin, project, plan, content, opts.skipLatest);
  const { object } = await askObject({ instructions: CHANGE, prompt, schema: ChangeDraft, model, fast: true });
  const diff = normalizeChange(object, current);
  if (isEmpty(diff)) {
    await opts.say(object.reply || "Nothing in the plan needs to change for that.", "plan");
    return {};
  }
  // Price the change: new parts, plus rebuilding changed parts that were already built.
  const built = Boolean(plan.agreed_at);
  const priced = [
    ...diff.add.map((a) => estimate(a, model)),
    ...diff.change
      .map((c) => current.find((i) => i.key === c.key)!)
      .filter((i) => built && i.item_class && i.size)
      .map((i) => estimate({ item_class: i.item_class as never, size: i.size as never }, model)),
  ];
  const t = planTotals(priced);
  const conflicts = conflictsOf(diff, current);
  const messageId = await opts.say(object.reply || "Here's the change. Nothing changes until you apply it.", "build");
  const { data: proposal } = await admin
    .from("change_proposals")
    .insert({
      project_id: project.id,
      message_id: messageId,
      // An unclear message's card offers "Just answer instead" (M5.8); the request travels with it for that.
      diff: { ...diff, base_version: plan.version, ...(opts.unclear ? { unclear: true, request: content } : {}) } as unknown as Json,
      estimate_likely: priced.length ? t.likely : 0,
      est_minutes: priced.length ? t.minutes : 0,
      conflict: conflicts.length ? ({ items: conflicts } as unknown as Json) : null,
      reply: object.reply,
      status: "proposed",
    })
    .select("id")
    .single();
  return { proposalId: proposal?.id };
}

/**
 * A chat message (BL-4, A-11, M5.8). There's no mode switch: each message is read as a question or a change request
 * (rules first, then one fast call on the default model). A question gets an answer, with no card and no new version.
 * A change request gets a change card with its price, and nothing changes until Apply; when the message was unclear
 * the card offers "Just answer instead". A Viewer's change request becomes a suggestion an Owner, Admin or Builder can
 * turn into a change. Messages are saved either way.
 */
export async function sendMessage(input: { projectId: string; content: string }): Promise<ChatResult> {
  const ctx = await getAppContext();
  const content = input.content.trim();
  if (!content) return { ok: false, message: "Type a message first." };
  if (content.length > 2000) return { ok: false, message: "Keep it under 2,000 characters." };
  const admin = createAdminDb();
  const project = await projectInWorkspace(admin, input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  const model = toModelChoice(project.model);
  // Never answer on a model the policy no longer allows, and never switch it silently (C-2).
  if (!(await allowedModels(admin, ctx.workspace.id)).includes(model)) {
    return { ok: false, message: `${MODEL_NOT_ALLOWED} in this workspace. Switch model to carry on. Your message wasn't sent.` };
  }
  const plan = await latestPlan(admin, project.id);

  const { data: saved } = await admin.from("messages").insert({ project_id: project.id, role: "user", mode: "build", content, model }).select("id").single();
  const say = async (text: string, mode: "plan" | "build") => {
    const { data } = await admin.from("messages").insert({ project_id: project.id, role: "architect", mode, content: text, model }).select("id").single();
    return data?.id ?? null;
  };

  if (!plan || plan.generation !== "ready") {
    await say(
      plan?.generation === "writing"
        ? "I'm still writing the plan. Once it's ready, tell me what to change and I'll show you a change card with its cost."
        : "There's no finished plan yet. Once there is, tell me what to change and I'll show you a change card with its cost.",
      "plan",
    );
    revalidatePath(`/p/${project.id}`);
    return { ok: true };
  }

  try {
    const { intent, unclear } = await classify(admin, ctx.workspace.id, content, model);
    // The user's message is a question: remember that, so the conversation reads right.
    if (intent === "question" && saved) await admin.from("messages").update({ mode: "plan" }).eq("id", saved.id);

    if (intent === "question") {
      const { prompt } = await chatPrompt(admin, project, plan, content, 1);
      const { text } = await ask({ instructions: ANSWER, prompt, model, maxOutputTokens: 500, fast: true });
      await say(text || "Could you say a bit more about what you'd like?", "plan");
      revalidatePath(`/p/${project.id}`);
      return { ok: true, intent };
    }

    if (!canBuild(ctx.role)) {
      // A Viewer can't change the plan: their request waits as a suggestion, with their name, for a Builder.
      const messageId = await say("I've passed this on as a suggestion. An Owner, Admin or Builder can turn it into a change.", "plan");
      const { data: proposal } = await admin
        .from("change_proposals")
        .insert({
          project_id: project.id,
          message_id: messageId,
          diff: { add: [], change: [], remove: [], base_version: plan.version, suggestion: { text: content, by: ctx.name, by_id: ctx.user.id } } as unknown as Json,
          estimate_likely: 0,
          est_minutes: 0,
          reply: content,
          status: "proposed",
        })
        .select("id")
        .single();
      revalidatePath(`/p/${project.id}`);
      return { ok: true, intent: "suggestion", proposalId: proposal?.id };
    }

    const r = await proposeChange(admin, project, plan, content, model, { unclear, skipLatest: 1, say });
    revalidatePath(`/p/${project.id}`);
    return { ok: true, intent, ...r };
  } catch (err) {
    const busy = err instanceof GatewayRateLimited || err instanceof GatewaySlow;
    await say(busyMessage(err), "plan");
    revalidatePath(`/p/${project.id}`);
    return { ok: false, rateLimited: busy, message: busy ? "The model is busy right now. Switch model, or try again in a minute." : "The model didn't answer. Try again." };
  }
}

async function proposalInWorkspace(admin: AdminDb, proposalId: string, workspaceId: string) {
  if (!z.string().uuid().safeParse(proposalId).success) return null;
  const { data: proposal } = await admin.from("change_proposals").select("id, project_id, diff, status, message_id").eq("id", proposalId).maybeSingle();
  if (!proposal) return null;
  const project = await projectInWorkspace(admin, proposal.project_id, workspaceId);
  return project ? { proposal, project } : null;
}

/**
 * "Just answer instead" (M5.8), on a card made from an unclear message: the card is discarded and Architect answers
 * the message as a question. No new version, nothing charged.
 */
export async function answerInstead(input: { proposalId: string }): Promise<ChatResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't change the plan." };
  const admin = createAdminDb();
  const found = await proposalInWorkspace(admin, input.proposalId, ctx.workspace.id);
  if (!found) return { ok: false, message: "That change isn't in this project." };
  const { proposal, project } = found;
  const diff = (proposal.diff ?? {}) as { request?: string };
  if (proposal.status !== "proposed" || !diff.request) return { ok: false, message: "This card can't be answered instead any more." };
  const plan = await latestPlan(admin, project.id);
  if (!plan) return { ok: false, message: "There's no plan to talk about yet." };
  await admin
    .from("change_proposals")
    .update({ status: "discarded", decided_by: ctx.user.id, decided_at: new Date().toISOString(), diff: { ...(proposal.diff as object), answered: true } as unknown as Json })
    .eq("id", proposal.id);
  const model = toModelChoice(project.model);
  try {
    const { prompt } = await chatPrompt(admin, project, plan, diff.request, 0);
    const { text } = await ask({ instructions: ANSWER, prompt, model, maxOutputTokens: 500, fast: true });
    await admin.from("messages").insert({ project_id: project.id, role: "architect", mode: "plan", content: text || "Could you say a bit more about what you'd like to know?", model });
    revalidatePath(`/p/${project.id}`);
    return { ok: true, intent: "question" };
  } catch (err) {
    await admin.from("messages").insert({ project_id: project.id, role: "architect", mode: "plan", content: busyMessage(err), model });
    revalidatePath(`/p/${project.id}`);
    return { ok: false, message: "The model didn't answer. Try again." };
  }
}

/**
 * "Turn into a change" (M5.8), on a Viewer's suggestion: an Owner, Admin or Builder makes it a change card with its
 * price, which still waits for Apply. The suggestion says who turned it into a change.
 */
export async function turnIntoChange(input: { proposalId: string }): Promise<ChatResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Only an Owner, Admin or Builder can turn a suggestion into a change." };
  const admin = createAdminDb();
  const found = await proposalInWorkspace(admin, input.proposalId, ctx.workspace.id);
  if (!found) return { ok: false, message: "That suggestion isn't in this project." };
  const { proposal, project } = found;
  const diff = (proposal.diff ?? {}) as { suggestion?: { text: string; by: string } };
  if (!diff.suggestion) return { ok: false, message: "That isn't a suggestion." };
  if (proposal.status !== "proposed") return { ok: false, message: "This suggestion is already a change." };
  const plan = await latestPlan(admin, project.id);
  if (!plan || plan.generation !== "ready") return { ok: false, message: "Wait for the plan to finish writing." };
  const model = toModelChoice(project.model);
  if (!(await allowedModels(admin, ctx.workspace.id)).includes(model)) {
    return { ok: false, message: `${MODEL_NOT_ALLOWED} in this workspace. Switch model to carry on.` };
  }
  await admin
    .from("change_proposals")
    .update({ status: "discarded", decided_by: ctx.user.id, decided_at: new Date().toISOString(), diff: { ...(proposal.diff as object), turned_by: ctx.name } as unknown as Json })
    .eq("id", proposal.id);
  const say = async (text: string, mode: "plan" | "build") => {
    const { data } = await admin.from("messages").insert({ project_id: project.id, role: "architect", mode, content: text, model }).select("id").single();
    return data?.id ?? null;
  };
  try {
    const r = await proposeChange(admin, project, plan, `${diff.suggestion.text} (suggested by ${diff.suggestion.by})`, model, { unclear: false, skipLatest: 0, say });
    revalidatePath(`/p/${project.id}`);
    return { ok: true, intent: "change", ...r };
  } catch (err) {
    // The suggestion stays open if the model couldn't make the card.
    await admin.from("change_proposals").update({ status: "proposed", decided_by: null, decided_at: null, diff: proposal.diff }).eq("id", proposal.id);
    await say(busyMessage(err), "plan");
    revalidatePath(`/p/${project.id}`);
    return { ok: false, message: "The model didn't answer. Try again." };
  }
}

const decisionsSchema = z.record(z.string(), z.object({ decision: z.enum(["keep", "defer", "drop"]), reason: z.string().max(200).optional() }));

/**
 * Apply a change card: the plan becomes a new version (A-5, A-11). Parts are copied by key with their status and
 * price; removed parts follow the person's Keep / Defer / Drop decisions (A-3). After a build, Apply is also the
 * click that starts building the change (CLAUDE.md rule 1), through the Build gate.
 */
export async function applyChange(input: { proposalId: string; decisions?: Record<string, Decision> }): Promise<ActionResult<{ version: number }>> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't change the plan. Ask an Owner, Admin or Builder." };
  if (!z.string().uuid().safeParse(input.proposalId).success) return { ok: false, message: "That change isn't in this project." };
  const decisions = decisionsSchema.safeParse(input.decisions ?? {});
  if (!decisions.success) return { ok: false, message: "Choose Keep, Set aside or Drop for each part." };

  const admin = createAdminDb();
  const { data: proposal } = await admin.from("change_proposals").select("id, project_id, diff, status, conflict").eq("id", input.proposalId).maybeSingle();
  if (!proposal) return { ok: false, message: "That change isn't in this project." };
  const project = await projectInWorkspace(admin, proposal.project_id, ctx.workspace.id);
  if (!project) return { ok: false, message: "That change isn't in this project." };
  if (proposal.status !== "proposed") return { ok: false, message: proposal.status === "applied" ? "This change is already applied." : "This change was discarded." };

  const plan = await latestPlan(admin, project.id);
  const diff = proposal.diff as unknown as Diff & { base_version: number };
  if (!plan || plan.generation !== "ready") return { ok: false, message: "Wait for the plan to finish writing." };
  if (plan.version !== diff.base_version) return { ok: false, message: "The plan changed since this card was made. Ask again and I'll make a fresh one." };

  const { data: items } = await admin.from("items").select(ITEM_FIELDS).eq("blueprint_id", plan.id).order("position");
  const current = (items ?? []) as (VersionItem & Record<string, unknown>)[];
  const built = Boolean(plan.agreed_at);
  // After a build, Apply builds the change: a paid action, stopped at the organisation's cap (C-7).
  if (built) {
    const stopped = await budgetRefusal(admin, ctx.workspace.id);
    if (stopped) return { ok: false, message: stopped };
  }
  let next: VersionItem[];
  try {
    next = applyDiff(current, diff, decisions.data, { built });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Decide what happens to each part first." };
  }

  const model = toModelChoice(project.model);
  const version = plan.version + 1;
  const priced = new Map(current.map((i) => [i.key, i]));
  const rows = next.map((i) => {
    const was = priced.get(i.key);
    const e = was?.estimate_likely != null ? null : i.item_class && i.size ? estimate({ item_class: i.item_class as never, size: i.size as never }, model) : null;
    return {
      ...i,
      framework: (was?.framework as string | null) ?? (i.grp === "agents" ? "lyzr" : null),
      status_detail: (was?.status_detail as string | null) ?? null,
      drop_reason: i.drop_reason ?? null,
      estimate_low: e ? e.low : (was?.estimate_low as number | null),
      estimate_likely: e ? e.likely : (was?.estimate_likely as number | null),
      estimate_high: e ? e.high : (was?.estimate_high as number | null),
      confidence: e ? e.confidence : (was?.confidence as string | null),
      est_seconds: e ? Math.round(e.seconds) : (was?.est_seconds as number | null),
      cost_driver: e ? e.driver : (was?.cost_driver as string | null),
    };
  });
  const counted = rows.filter((r) => r.status !== "deferred" && r.status !== "dropped");
  const t = planTotals(
    counted.map((r) => ({ low: Number(r.estimate_low ?? 0), likely: Number(r.estimate_likely ?? 0), high: Number(r.estimate_high ?? 0), seconds: Number(r.est_seconds ?? 0) })),
  );

  const { data: bp, error } = await admin
    .from("blueprints")
    .insert({
      project_id: project.id,
      version,
      status: "draft",
      generation: "ready",
      prompt: plan.prompt,
      name: plan.name,
      summary: plan.summary,
      not_in_this_version: plan.not_in_this_version,
      model: plan.model,
      simulated_model: plan.simulated_model,
      total_low: t.low,
      total_likely: t.likely,
      total_high: t.high,
      est_minutes: t.minutes,
      based_on: plan.version,
      created_by: ctx.user.id,
    })
    .select("id")
    .single();
  if (error || !bp) return { ok: false, message: "The new version couldn't be saved. Nothing changed. Try again." };
  await admin.from("items").insert(rows.map((r) => ({ ...r, blueprint_id: bp.id, project_id: project.id })));
  const [{ data: qs }, { data: ds }] = await Promise.all([
    admin.from("questions").select("text, affects, options, recommended, answer, blocking, position, answered_by, answered_at").eq("blueprint_id", plan.id),
    admin.from("defaults").select("label, value, alternatives, position").eq("blueprint_id", plan.id),
  ]);
  if (qs?.length) await admin.from("questions").insert(qs.map((q) => ({ ...q, blueprint_id: bp.id })));
  if (ds?.length) await admin.from("defaults").insert(ds.map((d) => ({ ...d, blueprint_id: bp.id })));
  if (!built) await admin.from("blueprints").update({ status: "superseded" }).eq("id", plan.id);

  await admin
    .from("change_proposals")
    .update({
      status: "applied",
      version_created: version,
      decided_by: ctx.user.id,
      decided_at: new Date().toISOString(),
      conflict: proposal.conflict ? ({ ...(proposal.conflict as object), decisions: decisions.data } as unknown as Json) : null,
    })
    .eq("id", proposal.id);
  await admin.from("projects").update({ current_version: version, updated_at: new Date().toISOString() }).eq("id", project.id);

  let note = `Applied. This is now plan v${version}.`;
  if (built) {
    // After a build, Apply is the click that builds the change.
    const { data: runId, error: gate } = await admin.rpc("agree_and_build", { p_blueprint: bp.id, p_user: ctx.user.id, p_kind: "change" });
    if (gate || !runId) {
      const why = gate?.message.includes("over_budget")
        ? "it would go past the budget"
        : gate?.message.includes("run_in_progress")
          ? "a build is still running. Apply it again when that finishes"
          : "answer the open question first";
      note = `Applied as plan v${version}. It isn't building yet: ${why}.`;
    } else {
      await startRun(admin, runId);
      note = `Applied as plan v${version}. Building the change now.`;
    }
  }
  await admin.from("messages").insert({ project_id: project.id, role: "system", mode: "build", content: note });
  revalidatePath(`/p/${project.id}`);
  return { ok: true, version };
}

/** Discard a change card. Nothing changes. */
export async function discardChange(input: { proposalId: string }): Promise<ActionResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't change the plan." };
  if (!z.string().uuid().safeParse(input.proposalId).success) return { ok: false, message: "That change isn't in this project." };
  const admin = createAdminDb();
  const { data: proposal } = await admin.from("change_proposals").select("id, project_id, status").eq("id", input.proposalId).maybeSingle();
  if (!proposal || !(await projectInWorkspace(admin, proposal.project_id, ctx.workspace.id))) return { ok: false, message: "That change isn't in this project." };
  if (proposal.status !== "proposed") return { ok: true };
  await admin.from("change_proposals").update({ status: "discarded", decided_by: ctx.user.id, decided_at: new Date().toISOString() }).eq("id", proposal.id);
  revalidatePath(`/p/${proposal.project_id}`);
  return { ok: true };
}

/**
 * "Add to plan" from the preview's Dark view (M5.8), when the app has no dark theme: a change card that adds one, with
 * its price, in chat. No model call: the part is always the same. Nothing changes until Apply. One open card at a time.
 */
export async function proposeDarkTheme(input: { projectId: string }): Promise<ChatResult> {
  const ctx = await getAppContext();
  if (!canBuild(ctx.role)) return { ok: false, message: "Viewers can't change the plan. Ask an Owner, Admin or Builder." };
  const admin = createAdminDb();
  const project = await projectInWorkspace(admin, input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  const plan = await latestPlan(admin, project.id);
  if (!plan || plan.generation !== "ready") return { ok: false, message: "Wait for the plan to finish writing." };
  const { data: open } = await admin.from("change_proposals").select("id, diff").eq("project_id", project.id).eq("status", "proposed");
  const already = (open ?? []).find((p) => ((p.diff ?? {}) as Diff).add?.some((a) => a.key === DARK_THEME_PART.key));
  if (already) return { ok: true, proposalId: already.id, intent: "change" };

  const { data: items } = await admin.from("items").select("key").eq("blueprint_id", plan.id);
  if ((items ?? []).some((i) => i.key === DARK_THEME_PART.key)) return { ok: false, message: "The plan already has a dark theme." };
  const model = toModelChoice(project.model);
  const part = { ...DARK_THEME_PART, grp: "features", source_quote: "Add a dark theme (from the preview's Dark view)", item_class: "screen.detail", size: "s" };
  const price = estimate({ item_class: "screen.detail", size: "s" }, model);
  const t = planTotals([price]);
  const { data: msg } = await admin.from("messages").insert({ project_id: project.id, role: "user", mode: "build", content: "Add a dark theme to the app.", model }).select("id").single();
  const { data: reply } = await admin
    .from("messages")
    .insert({ project_id: project.id, role: "architect", mode: "build", content: "I'd add a dark theme that follows each person's device setting, checked for contrast on every screen.", model })
    .select("id")
    .single();
  const { data: proposal } = await admin
    .from("change_proposals")
    .insert({
      project_id: project.id,
      message_id: reply?.id ?? msg?.id ?? null,
      diff: { add: [part], change: [], remove: [], base_version: plan.version } as unknown as Json,
      estimate_likely: t.likely,
      est_minutes: t.minutes,
      reply: "I'd add a dark theme.",
      status: "proposed",
    })
    .select("id")
    .single();
  revalidatePath(`/p/${project.id}`);
  return { ok: true, proposalId: proposal?.id, intent: "change" };
}
