import { DEMO_PLAN_DAILY_LIMIT, planDailyLimit, planLimitMessage, startOfDayUtc } from "@/lib/plan-limit";
import { attachedFileKind, fileParts, type AttachedFile } from "@/lib/file-parts";
import "server-only";

import type { Item as ItemT } from "@/lib/blueprint";
import { GatewayRateLimited, GatewaySlow, GatewayUnavailable, modelName, resolveModel } from "@/lib/gateway";
import { canBuild } from "@/lib/permissions";
import { MODEL_LABEL, resolvePick, type ModelChoice } from "@/lib/models";
import type { AdminDb } from "../db";
import { budgetRefusal, loadPolicies } from "../policy";
import { draftingCredits, estimate, totals as planTotals } from "../estimate";
import { applyRepoProofs } from "../import";
import type { AppContext } from "../workspace";
import { BlueprintInvalid, generateBlueprint, type Attachment } from "./generate";
import { track } from "../analytics";

/** A part as the client shows it: the plan's fields plus its server-side price. */
export type PlanItem = ItemT & {
  id: string;
  position: number;
  estimate: { low: number; likely: number; high: number; confidence: "low" | "medium" | "high"; driver: string; seconds: number };
};

export type PlanEvent =
  | { type: "started"; blueprintId: string; version: number; model: { label: string; simulated: boolean }; note?: string }
  | { type: "item"; item: PlanItem }
  | { type: "reset"; problems: string[] }
  | { type: "done"; blueprintId: string; name: string; summary: string; totals: { low: number; likely: number; high: number; minutes: number }; questions: number; blocking: number }
  | { type: "error"; kind: "rate_limited" | "slow" | "invalid" | "unavailable" | "refused"; message: string; kept: number };

export class PlanRefused extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "PlanRefused";
  }
}

/** Models the workspace's policy allows (BL-3, C-2); every model with governance off. */
export async function allowedModels(admin: AdminDb, workspaceId: string): Promise<ModelChoice[]> {
  return (await loadPolicies(admin, workspaceId)).models.allowed;
}

/** The model a project's step runs on: Auto (M5.8) resolves to the workspace's Architect model, if it's allowed. */
export async function stepModel(admin: AdminDb, workspaceId: string, raw: string | null): Promise<ModelChoice> {
  const { models } = await loadPolicies(admin, workspaceId);
  return resolvePick(raw, models.allowed, models.architect);
}

/** The project's uploads for the planner: PDF text, and images passed to the model as images. */
async function loadAttachments(admin: AdminDb, projectId: string): Promise<Attachment[]> {
  const { data } = await admin.from("files").select("name, path, mime, storage_path, extracted_text").eq("project_id", projectId).eq("kind", "upload");
  const out: Attachment[] = [];
  for (const f of data ?? []) {
    const name = f.name ?? f.path;
    if (f.extracted_text) out.push({ name, text: f.extracted_text });
    else if (f.mime?.startsWith("image/") && f.storage_path) {
      const { data: blob } = await admin.storage.from("uploads").download(f.storage_path);
      if (blob) out.push({ name, image: { data: new Uint8Array(await blob.arrayBuffer()), mediaType: f.mime } });
    }
  }
  return out;
}

/**
 * Writes a plan for a project (docs/build/BLUEPRINT-GENERATION.md): creates the next version in "writing", saves each part
 * with its price as it arrives, then the questions, defaults, totals and a small Usage line. Never starts a build.
 * Refusals (wrong workspace, Viewer, model not allowed, already writing) throw PlanRefused before anything is saved.
 */
export async function writePlan(
  input: { admin: AdminDb; ctx: AppContext; projectId: string; prompt?: string; model?: ModelChoice },
  emit: (e: PlanEvent) => void,
): Promise<void> {
  const { admin, ctx } = input;
  if (!canBuild(ctx.role)) throw new PlanRefused("Viewers can't write plans. Ask an Owner, Admin or Builder.", 403);

  const { data: project } = await admin
    .from("projects")
    .select("id, workspace_id, name, prompt, model, repo_full_name")
    .eq("id", input.projectId)
    .eq("workspace_id", ctx.workspace.id)
    .maybeSingle();
  if (!project) throw new PlanRefused("That project isn't in this workspace.", 404);

  const prompt = (input.prompt ?? project.prompt ?? "").trim();
  if (!prompt) throw new PlanRefused("Describe what you want first.", 400);
  if (prompt.length > 4000) throw new PlanRefused("Keep the request under 4,000 characters.", 400);

  // Auto (M5.8) resolves to an allowed model for this step.
  const model = input.model ?? (await stepModel(admin, ctx.workspace.id, project.model));
  if (!(await allowedModels(admin, ctx.workspace.id)).includes(model)) {
    throw new PlanRefused(`${MODEL_LABEL[model]} isn't allowed in this workspace. Pick another model.`, 403);
  }
  // Drafting a plan costs credits: stopped at the organisation's cap (C-7).
  const stopped = await budgetRefusal(admin, ctx.workspace.id);
  if (stopped) throw new PlanRefused(stopped, 402);
  // The daily limit per person (M5.5): before any model call, so a refused plan costs no quota.
  const now = new Date();
  const demo = Boolean(ctx.user.is_anonymous);
  const limit = demo ? DEMO_PLAN_DAILY_LIMIT : planDailyLimit(process.env.PLAN_DAILY_LIMIT);
  const { count: today } = await admin.from("blueprints").select("id", { count: "exact", head: true }).eq("created_by", ctx.user.id).gte("created_at", startOfDayUtc(now).toISOString());
  if ((today ?? 0) >= limit) throw new PlanRefused(planLimitMessage(limit, now, demo), 429);
  const resolved = resolveModel(model);
  // The model actually writing it: OpenRouter's free model if Gemini refuses on quota (M5.10).
  let used: ModelChoice = model;
  let usedResolved = resolved;

  const { data: last } = await admin.from("blueprints").select("version").eq("project_id", project.id).order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (last?.version ?? 0) + 1;
  const { data: bp, error: bpError } = await admin
    .from("blueprints")
    .insert({ project_id: project.id, version, prompt, model, simulated_model: resolved.simulated, generation: "writing", created_by: ctx.user.id })
    .select("id")
    .single();
  if (bpError || !bp) {
    if (bpError?.message.includes("blueprints_one_writing")) throw new PlanRefused("A plan is already being written for this project.", 409);
    throw new PlanRefused("The plan couldn't be started. Try again.", 500);
  }
  if (prompt !== project.prompt) await admin.from("projects").update({ prompt }).eq("id", project.id);
  emit({ type: "started", blueprintId: bp.id, version, model: { label: resolved.label, simulated: resolved.simulated } });

  const saved = new Map<string, PlanItem>();
  const saveItem = async (item: ItemT, position: number) => {
    const e = estimate(item, used);
    const { data } = await admin
      .from("items")
      .upsert(
        {
          blueprint_id: bp.id,
          project_id: project.id,
          key: item.key,
          grp: item.grp,
          title: item.title,
          description: item.description,
          proved_when: item.proved_when,
          source_quote: item.source_quote,
          item_class: item.item_class,
          size: item.size,
          provider: item.provider ?? null,
          framework: item.grp === "agents" ? (item.framework ?? "lyzr") : null,
          estimate_low: e.low,
          estimate_likely: e.likely,
          estimate_high: e.high,
          confidence: e.confidence,
          est_seconds: Math.round(e.seconds),
          cost_driver: e.driver,
          position,
          status: "proposed",
        },
        { onConflict: "blueprint_id,key" },
      )
      .select("id")
      .single();
    const planItem: PlanItem = { ...item, id: data?.id ?? item.key, position, estimate: e };
    saved.set(item.key, planItem);
    return planItem;
  };

  try {
    if (process.env.NODE_ENV !== "production" && prompt.includes("[[simulate-429]]")) {
      // Test hook (never in production): lets the e2e suite show the paused banner without spending quota.
      throw new GatewayRateLimited(resolved.label);
    }
    const attachments = await loadAttachments(admin, project.id);
    const { data: conns } = await admin.from("connections").select("provider").eq("workspace_id", ctx.workspace.id).eq("status", "connected").neq("kind", "mcp");
    const write = (m: ModelChoice) =>
      generateBlueprint(
        { prompt, attachments, model: m, connected: (conns ?? []).map((c) => c.provider) },
        {
          onItem: async (item, index) => emit({ type: "item", item: await saveItem(item, index) }),
          onRetry: async (problems) => {
            await admin.from("items").delete().eq("blueprint_id", bp.id);
            saved.clear();
            emit({ type: "reset", problems });
          },
        },
      );
    let result: Awaited<ReturnType<typeof write>>;
    try {
      result = await write(model);
    } catch (err) {
      // Gemini refused on quota or its rate limit, after the gateway's retries (M5.10): when OpenRouter's free model
      // is set up and allowed here, it writes the plan instead, and the chat says so in one line. Never silently.
      const geminiAnswered = resolved.choice === "gemini" || resolved.simulated;
      const openRouter = resolveModel("openrouter");
      if (!(err instanceof GatewayRateLimited) || !geminiAnswered || openRouter.simulated || !(await allowedModels(admin, ctx.workspace.id)).includes("openrouter")) throw err;
      await admin.from("items").delete().eq("blueprint_id", bp.id);
      saved.clear();
      used = "openrouter";
      usedResolved = openRouter;
      await admin.from("blueprints").update({ model: "openrouter", simulated_model: false }).eq("id", bp.id);
      const note = `${modelName("gemini")} is busy right now (its free limit), so ${modelName("openrouter")} is writing this plan instead.`;
      await admin.from("messages").insert({ project_id: project.id, role: "architect", mode: "plan", content: note });
      emit({ type: "started", blueprintId: bp.id, version, model: { label: openRouter.label, simulated: false }, note });
      result = await write("openrouter");
    }
    const plan = result.blueprint;
    // A PDF the plan doesn't use becomes a knowledge base, a CSV a data analyst (simulated, as today's Architect).
    const files = attachments.map((a) => ({ name: a.name, kind: attachedFileKind(a.name) })).filter((f): f is AttachedFile => f.kind !== null);
    plan.items.push(...fileParts(files, plan.items));

    // Reconcile with the final plan: same keys in the same order (streamed parts are almost always identical).
    for (const [i, item] of plan.items.entries()) await saveItem(item, i);
    const finalKeys = new Set(plan.items.map((i) => i.key));
    const stale = [...saved.keys()].filter((k) => !finalKeys.has(k));
    if (stale.length) await admin.from("items").delete().eq("blueprint_id", bp.id).in("key", stale);

    if (plan.questions.length) {
      await admin.from("questions").insert(
        plan.questions.map((q, position) => ({
          blueprint_id: bp.id,
          text: q.text,
          affects: q.affects,
          options: q.options,
          recommended: q.recommended,
          blocking: Boolean(q.blocking),
          default_effect: q.default_effect,
          position,
        })),
      );
    }
    if (plan.defaults.length) {
      await admin.from("defaults").insert(plan.defaults.map((d, position) => ({ blueprint_id: bp.id, label: d.label, value: d.value, alternatives: d.alternatives, position })));
    }
    // A plan from a repo: parts that work today, proved by the repo's own tests, aren't built or charged again (B-2).
    const works = project.repo_full_name ? await applyRepoProofs(admin, { projectId: project.id, blueprintId: bp.id }) : new Set<string>();
    const t = planTotals(plan.items.filter((i) => !works.has(i.key)).map((i) => estimate(i, used)));
    const credits = draftingCredits(result.tokens);
    await admin
      .from("blueprints")
      .update({
        generation: "ready",
        name: plan.name,
        summary: plan.summary,
        not_in_this_version: plan.not_in_this_version,
        total_low: t.low,
        total_likely: t.likely,
        total_high: t.high,
        est_minutes: t.minutes,
        drafting_credits: credits,
      })
      .eq("id", bp.id);
    await admin
      .from("projects")
      .update({
        name: project.name === "Untitled app" ? plan.name : project.name,
        model,
        current_version: version,
        updated_at: new Date().toISOString(),
      })
      .eq("id", project.id);
    await admin.from("usage_ledger").insert({
      workspace_id: ctx.workspace.id,
      project_id: project.id,
      kind: "blueprint",
      credits,
      note: `Plan written · v${version}${usedResolved.simulated ? ` · ${usedResolved.label} (simulated)` : used !== model ? ` · ${usedResolved.label} (Gemini was busy)` : ""}`,
    });
    await track("plan_written", { user: ctx.user, workspaceId: ctx.workspace.id, projectId: project.id, detail: `v${version}` });
    const blocking = plan.questions.filter((q) => q.blocking).length; // decided by the server (applyQuestionRules)
    emit({ type: "done", blueprintId: bp.id, name: plan.name, summary: plan.summary, totals: t, questions: plan.questions.length, blocking });
  } catch (err) {
    const kind = err instanceof GatewayRateLimited ? "rate_limited" : err instanceof GatewaySlow ? "slow" : err instanceof BlueprintInvalid ? "invalid" : "unavailable";
    const message =
      kind === "rate_limited"
        ? `${usedResolved.label} is busy right now (the free model's limit). The parts written so far are kept. Switch model, or try again in a minute.`
        : kind === "slow"
          ? `${usedResolved.label} is taking too long (over ${(err as GatewaySlow).seconds} s). The parts written so far are kept. Switch model, or try again.`
          : kind === "invalid"
          ? "The plan stopped part-way: it didn't pass its checks. The parts written so far are kept."
          : `${usedResolved.label} didn't answer. The parts written so far are kept.`;
    await admin
      .from("blueprints")
      .update({ generation: "failed", error_kind: kind, error: err instanceof Error ? err.message.slice(0, 500) : String(err) })
      .eq("id", bp.id);
    if (!(err instanceof GatewayRateLimited) && !(err instanceof GatewaySlow) && !(err instanceof GatewayUnavailable) && !(err instanceof BlueprintInvalid)) {
      console.error("writePlan failed", err instanceof Error ? err.name : "unknown");
    }
    emit({ type: "error", kind, message, kept: saved.size });
  }
}
