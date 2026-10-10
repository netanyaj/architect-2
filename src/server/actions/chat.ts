"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Json } from "@/lib/database.types";
import { askObject, GatewayRateLimited, GatewaySlow, ask } from "@/lib/gateway";
import { toModelChoice } from "@/lib/models";
import { MODEL_NOT_ALLOWED } from "@/lib/policies";
import { canBuild } from "@/lib/permissions";
import { applyDiff, ChangeDraft, conflictsOf, isEmpty, normalizeChange, type Decision, type Diff, type VersionItem } from "@/lib/plan-diff";
import { allowedModels } from "../blueprint/write-plan";
import { createAdminDb, type AdminDb } from "../db";
import { estimate, totals as planTotals } from "../estimate";
import { startRun } from "../sim/run";
import { budgetRefusal } from "../policy";
import { getAppContext } from "../workspace";
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

const TALK_FIRST = `You are Architect, talking a plan through with the person who owns it. "Talk first" is on: discuss, explain and
suggest, but never change the plan and never say you changed it. If they want a change, say what you would change and
that they can turn off Talk first to get a change card. Plain words, sentence case, 1 to 5 short sentences, no markdown.
Never invent costs; the plan's prices come from the system.`;

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

export type ChatResult = ActionResult<{ proposalId?: string }> & { rateLimited?: boolean };

/**
 * A chat message (BL-4, A-11). With Talk first on, Architect answers and never changes the plan. Otherwise a
 * request becomes a change card with its price; nothing changes until Apply. Messages are saved either way.
 */
export async function sendMessage(input: { projectId: string; content: string; talkFirst: boolean }): Promise<ChatResult> {
  const ctx = await getAppContext();
  const content = input.content.trim();
  if (!content) return { ok: false, message: "Type a message first." };
  if (content.length > 2000) return { ok: false, message: "Keep it under 2,000 characters." };
  if (!input.talkFirst && !canBuild(ctx.role)) {
    return { ok: false, message: "Viewers can talk the plan through but can't change it. Turn on Talk first." };
  }
  const admin = createAdminDb();
  const project = await projectInWorkspace(admin, input.projectId, ctx.workspace.id);
  if (!project) return { ok: false, message: "That project isn't in this workspace." };
  const model = toModelChoice(project.model);
  // Never answer on a model the policy no longer allows, and never switch it silently (C-2).
  if (!(await allowedModels(admin, ctx.workspace.id)).includes(model)) {
    return { ok: false, message: `${MODEL_NOT_ALLOWED} in this workspace. Switch model to carry on. Your message wasn't sent.` };
  }
  const plan = await latestPlan(admin, project.id);

  await admin.from("messages").insert({ project_id: project.id, role: "user", mode: input.talkFirst ? "plan" : "build", content, model });

  const say = async (text: string) => {
    const { data } = await admin.from("messages").insert({ project_id: project.id, role: "architect", mode: input.talkFirst ? "plan" : "build", content: text, model }).select("id").single();
    return data?.id ?? null;
  };

  if (!plan || plan.generation !== "ready") {
    await say(
      plan?.generation === "writing"
        ? "I'm still writing the plan. Once it's ready, tell me what to change and I'll show you a change card with its cost."
        : "There's no finished plan yet. Once there is, tell me what to change and I'll show you a change card with its cost.",
    );
    revalidatePath(`/p/${project.id}`);
    return { ok: true };
  }

  const [{ data: items }, { data: questions }, { data: history }] = await Promise.all([
    admin.from("items").select(ITEM_FIELDS).eq("blueprint_id", plan.id).order("position"),
    admin.from("questions").select("text, answer, recommended").eq("blueprint_id", plan.id),
    admin.from("messages").select("role, content").eq("project_id", project.id).order("created_at", { ascending: false }).limit(9),
  ]);
  const current = (items ?? []) as VersionItem[];
  const context = planContext(plan.name ?? project.name, current, questions ?? []);
  const convo = (history ?? [])
    .slice(1) // the message just saved
    .reverse()
    .map((m) => `${m.role === "user" ? "Person" : "Architect"}: ${m.content}`)
    .join("\n");
  const prompt = `${context}\n\nOriginal request: ${plan.prompt}\n${convo ? `\nConversation so far:\n${convo}\n` : ""}\nPerson: ${content}`;

  try {
    if (input.talkFirst) {
      const { text } = await ask({ instructions: TALK_FIRST, prompt, model, maxOutputTokens: 500, fast: true });
      await say(text || "Could you say a bit more about what you'd like?");
      revalidatePath(`/p/${project.id}`);
      return { ok: true };
    }

    const { object } = await askObject({ instructions: CHANGE, prompt, schema: ChangeDraft, model, fast: true });
    const diff = normalizeChange(object, current);
    if (isEmpty(diff)) {
      await say(object.reply || "Nothing in the plan needs to change for that.");
      revalidatePath(`/p/${project.id}`);
      return { ok: true };
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
    const messageId = await say(object.reply || "Here's the change. Nothing changes until you apply it.");
    const { data: proposal } = await admin
      .from("change_proposals")
      .insert({
        project_id: project.id,
        message_id: messageId,
        diff: { ...diff, base_version: plan.version } as unknown as Json,
        estimate_likely: priced.length ? t.likely : 0,
        est_minutes: priced.length ? t.minutes : 0,
        conflict: conflicts.length ? ({ items: conflicts } as unknown as Json) : null,
        reply: object.reply,
        status: "proposed",
      })
      .select("id")
      .single();
    revalidatePath(`/p/${project.id}`);
    return { ok: true, proposalId: proposal?.id };
  } catch (err) {
    const busy = err instanceof GatewayRateLimited || err instanceof GatewaySlow;
    await say(
      err instanceof GatewaySlow
        ? "The free model took too long, so I stopped it. Your message is saved. Switch model, or try again."
        : busy
          ? "The model is busy right now (the free model's limit), so I couldn't answer. Your message is saved. Switch model, or try again in a minute."
          : "I couldn't reach the model just now. Your message is saved. Try again in a moment.",
    );
    revalidatePath(`/p/${project.id}`);
    return { ok: false, rateLimited: busy, message: busy ? "The model is busy right now. Switch model, or try again in a minute." : "The model didn't answer. Try again." };
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
