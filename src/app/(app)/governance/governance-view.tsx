"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { DataFlow } from "@/components/ax/data-flow";
import { DetailBody, DetailHead, MasterDetail, MasterRow } from "@/components/ax/master-detail";
import { SimTag, Tag } from "@/components/ax/pill";
import { Segmented } from "@/components/ax/segmented";
import { Select } from "@/components/ax/select";
import { Toggle } from "@/components/ax/toggle";
import { egressOfDraft, hostProblem, REDACTIONS, type EgressPolicy, type FlowPath, type Redaction } from "@/lib/egress";
import { MODEL_LABEL, type ModelChoice, type ModelOption } from "@/lib/models";
import { auditCsv, BY_LABEL, filterAudit, type AuditBy, type AuditEntry } from "@/lib/audit";
import {
  AWS_REGIONS,
  budgetState,
  capProblem,
  PERMISSIONS,
  type PermissionRules,
  LOCATION_LATER,
  LOCATIONS,
  placement,
  providerName,
  SCOPE_LABEL,
  scopeOf,
  summaries,
  type AppPolicy,
  type LocationPolicy,
  type ModelPolicy,
  type Scope,
} from "@/lib/policies";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { addMcpServer, registerPrivateModel, removeMcpServer, removePrivateModel, saveAppPolicy, saveBudgets, saveEgress, saveLocation, saveModelPolicy, savePermissionRules } from "@/server/actions/policies";
import { normalizeMcpUrl } from "@/lib/mcp-connections";

export type Section = "location" | "models" | "apps" | "egress" | "rules" | "budgets" | "audit";

const TITLES: Record<Section, string> = {
  location: "Where it runs",
  models: "Models",
  apps: "Apps and MCP servers",
  egress: "Data and egress",
  rules: "Permission rules",
  budgets: "Budgets",
  audit: "Audit log",
};

export type BudgetView = { cap: number | null; spent: number; allowance: number };
export type ProjectBudget = { id: string; name: string; cap: number | null; spent: number };

export type ProjectFlows = { id: string; name: string; paths: FlowPath[] };
const SIM_NOTE = "The policy is a real setting; enforcing it on infrastructure is simulated in this prototype.";

/** Governance (C-1 to C-3): the sections on the left, the selected one on the right with its effect and Save. */
export function GovernanceView(props: {
  workspaceName: string;
  initialSection: Section;
  location: LocationPolicy;
  models: ModelPolicy;
  apps: AppPolicy;
  availability: ModelOption[];
  known: string[];
  /** MCP servers added in Connections (M6), so the allowed list can link to each one. */
  mcpConnections?: { id: string; url: string; connected: boolean; tools: number }[];
  egress: EgressPolicy;
  flows: ProjectFlows[];
  permissions: PermissionRules;
  budget: BudgetView;
  projectBudgets: ProjectBudget[];
  audit: AuditEntry[];
}) {
  const [section, setSection] = useState<Section>(props.initialSection);
  const [notice, setNotice] = useState<string>();
  // Kept here: saving the apps reloads that form, and what's being typed for a new MCP server must survive it.
  const mcpForm = useState({ name: "", url: "" });
  const lines = summaries(props);
  const blockedProjects = props.flows.filter((f) => f.paths.some((p) => !p.allowed)).length;
  const budgetLevel = budgetState(props.budget.cap, props.budget.spent).level;
  const pick = (s: Section) => {
    setSection(s);
    setNotice(undefined);
    const url = new URL(window.location.href);
    url.searchParams.set("section", s);
    window.history.replaceState(null, "", url);
  };
  return (
    <MasterDetail
      title="Governance"
      intro={
        <span className="flex flex-wrap items-center gap-2">
          Rules for every project in {props.workspaceName}. Builders see their effect where they work. <SimTag title={SIM_NOTE} />
        </span>
      }
      listLabel="Policies"
      detailLabel="Policy"
      rows={
        <>
          <MasterRow on={section === "location"} onClick={() => pick("location")} status="todo" icon="lines" title={TITLES.location} meta={lines.location} />
          <MasterRow on={section === "models"} onClick={() => pick("models")} status="todo" icon="lines" title={TITLES.models} meta={lines.models} />
          <MasterRow on={section === "apps"} onClick={() => pick("apps")} status="todo" icon="lines" title={TITLES.apps} meta={lines.apps} />
          <MasterRow
            on={section === "rules"}
            onClick={() => pick("rules")}
            status="todo"
            icon="lock"
            title={TITLES.rules}
            meta={`Needs approval: ${PERMISSIONS.filter((x) => props.permissions[x.id]).map((x) => x.label.toLowerCase()).join(", ") || "nothing"}`}
          />
          <MasterRow on={section === "budgets"} onClick={() => pick("budgets")} status={budgetLevel === "stopped" || budgetLevel === "alert" ? "attention" : "todo"} icon={budgetLevel === "stopped" || budgetLevel === "alert" ? "alert" : "lines"} title={TITLES.budgets} meta={props.budget.cap ? `${props.budget.spent.toLocaleString("en-GB")} of ${props.budget.cap.toLocaleString("en-GB")} credits this month` : "No monthly cap"} />
          <MasterRow on={section === "audit"} onClick={() => pick("audit")} status="todo" icon="lines" title={TITLES.audit} meta={`${props.audit.length} recent ${props.audit.length === 1 ? "entry" : "entries"}`} />
          <MasterRow on={section === "egress"} onClick={() => pick("egress")} status={blockedProjects ? "attention" : "todo"} icon={blockedProjects ? "alert" : "lines"} title={TITLES.egress} meta={`${props.egress.hosts.length} host${props.egress.hosts.length === 1 ? "" : "s"} allowed${blockedProjects ? ` · ${blockedProjects} project${blockedProjects === 1 ? "" : "s"} held` : ""}`} />
          <li className="px-2.5 pt-2 text-small text-ink-2">
            Requests your rules hold back are in <TextLink href="/governance/approvals">Approvals</TextLink>.
          </li>
        </>
      }
    >
      {notice && (
        <p role="status" className="mx-6 mt-5 rounded-card border-[1.5px] border-line px-4 py-2.5 font-semibold max-sm:mx-4">
          {notice}
        </p>
      )}
      {/* Keyed on what's stored, so a saved change (or a registered model) starts the form again from it. */}
      {section === "location" && <LocationEditor key={JSON.stringify(props.location)} location={props.location} models={props.models} onSaved={setNotice} />}
      {section === "models" && <ModelsEditor key={JSON.stringify(props.models)} models={props.models} availability={props.availability} onSaved={setNotice} />}
      {section === "egress" && <EgressEditor key={JSON.stringify(props.egress)} egress={props.egress} flows={props.flows} onSaved={setNotice} />}
      {section === "rules" && <RulesEditor key={JSON.stringify(props.permissions)} permissions={props.permissions} onSaved={setNotice} />}
      {section === "budgets" && <BudgetsEditor key={JSON.stringify([props.budget, props.projectBudgets])} budget={props.budget} projects={props.projectBudgets} onSaved={setNotice} />}
      {section === "audit" && <AuditView entries={props.audit} />}
      {section === "apps" && <AppsEditor key={JSON.stringify([props.apps, props.known])} apps={props.apps} known={props.known} onSaved={setNotice} mcpForm={mcpForm} connections={props.mcpConnections ?? []} />}
    </MasterDetail>
  );
}

/** Save with a pending state and an inline error; tells the view what changed. */
function useSave(onSaved: (note: string) => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, note: string) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      onSaved(note);
      router.refresh();
    });
  return { pending, error, run };
}

function ErrorLine({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="font-semibold text-failed">
      {error}
    </p>
  ) : null;
}

/* ------------------------------------------------------------------ C-1 */

function LocationEditor({ location, models, onSaved }: { location: LocationPolicy; models: ModelPolicy; onSaved: (n: string) => void }) {
  const [draft, setDraft] = useState<LocationPolicy>(location);
  const { pending, error, run } = useSave(onSaved);
  const regionId = useId();
  const changed = draft.mode !== location.mode || draft.region !== location.region;
  const { zones, notes } = placement(draft, models);
  return (
    <DetailBody
      footer={
        <Button variant="primary" disabledReason={pending ? "Saving…" : changed ? undefined : "Nothing changed yet."} onClick={() => run(() => saveLocation(draft), "Saved. New builds and deploys run in the place you picked.")}>
          Save where it runs
        </Button>
      }
    >
      <DetailHead kicker={<>Organisation policy <SimTag title={SIM_NOTE} /></>} title="Where Architect and your apps run">
        Pick once for the whole organisation. The picture shows where each part runs.
      </DetailHead>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-small font-semibold text-ink-2">Place</legend>
        {LOCATIONS.map((l) => (
          <label
            key={l.mode}
            title={l.available ? undefined : LOCATION_LATER}
            className={cn("flex items-start gap-3 rounded-card border border-line p-3.5", draft.mode === l.mode && "border-2 border-ink p-[13px]", !l.available && "cursor-not-allowed text-ink-3")}
          >
            <input
              type="radio"
              name="location"
              className="mt-1 size-4 accent-[var(--ink)]"
              checked={draft.mode === l.mode}
              disabled={!l.available}
              onChange={() => setDraft({ mode: l.mode, region: l.mode === "customer_vpc" ? (draft.region ?? "us-east-1") : null })}
            />
            <span className="flex flex-col">
              <span className="font-semibold">{l.label}</span>
              <span className="text-small text-ink-2">{l.available ? l.detail : `${l.detail} Not in this version yet.`}</span>
            </span>
          </label>
        ))}
        <p className="text-small text-ink-2">{LOCATION_LATER}</p>
      </fieldset>
      {draft.mode === "customer_vpc" && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={regionId} className="text-small font-semibold text-ink-2">
            AWS region
          </label>
          <Select id={regionId} value={draft.region ?? "us-east-1"} onChange={(e) => setDraft({ ...draft, region: e.target.value })}>
            {AWS_REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} · {r.id}
              </option>
            ))}
          </Select>
        </div>
      )}
      <figure aria-label="Where each part runs" className="flex flex-col gap-2.5">
        <figcaption className="text-small font-semibold text-ink-2">Where each part runs</figcaption>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {zones.map((z) => (
            <div key={z.name} className={cn("flex flex-col gap-2 rounded-card p-3.5", z.owner === "yours" ? "border-2 border-ink" : z.owner === "lyzr" ? "border border-line bg-tray" : "border border-dashed border-line-ctl")}>
              <span className="flex flex-col">
                <strong className="font-[650]">{z.name}</strong>
                <span className="text-small text-ink-2">{z.owner === "yours" ? "You run this" : z.owner === "lyzr" ? "Lyzr runs this" : "Outside: reached over the internet"}</span>
              </span>
              <ul className="flex flex-wrap gap-1.5">
                {z.components.map((c) => (
                  <li key={c}>
                    <Tag className="h-auto py-0.5 whitespace-normal">{c}</Tag>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {notes.map((n) => (
          <p key={n} className="text-small text-ink-2">
            {n}
          </p>
        ))}
      </figure>
      <p className="text-small text-ink-2">Where builders see it: each app&apos;s Launch page says where its versions run.</p>
      <ErrorLine error={error} />
    </DetailBody>
  );
}

/* ------------------------------------------------------------------ C-2 */

function ModelsEditor({ models, availability, onSaved }: { models: ModelPolicy; availability: ModelOption[]; onSaved: (n: string) => void }) {
  const [allowed, setAllowed] = useState<ModelChoice[]>(models.allowed);
  const [architect, setArchitect] = useState<ModelChoice>(models.architect);
  const [agentDefault, setAgentDefault] = useState<ModelChoice>(models.agentDefault);
  const [ownKeys, setOwnKeys] = useState<ModelChoice[]>(models.ownKeys);
  const { pending, error, run } = useSave(onSaved);
  const ids = { architect: useId(), agents: useId() };
  const name = (m: ModelChoice) => (m === "private" && models.private ? models.private.name : MODEL_LABEL[m]);
  const rows = availability.filter((m) => m.choice !== "private" || models.private);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const changed =
    allowed.slice().sort().join() !== models.allowed.slice().sort().join() || architect !== models.architect || agentDefault !== models.agentDefault || ownKeys.slice().sort().join() !== models.ownKeys.slice().sort().join();
  return (
    <DetailBody
      footer={
        <Button
          variant="primary"
          disabledReason={pending ? "Saving…" : changed ? undefined : "Nothing changed yet."}
          onClick={() => run(() => saveModelPolicy({ allowed, architect, agentDefault, ownKeys }), "Saved. Model pickers show only the allowed models.")}
        >
          Save models
        </Button>
      }
    >
      <DetailHead kicker={<>Organisation policy <SimTag title={SIM_NOTE} /></>} title="Which models Architect and your agents use">
        Pickers show only the allowed models. A project or agent on a model you stop allowing shows &ldquo;This model is no longer allowed · Switch&rdquo;; nothing switches on its own.
      </DetailHead>
      <fieldset className="flex flex-col rounded-card border border-line">
        <legend className="sr-only">Allowed models</legend>
        {rows.map((m, i) => (
          <div key={m.choice} className={cn("flex flex-wrap items-center gap-3 px-3.5 py-3", i > 0 && "border-t border-line")}>
            <label className="flex min-w-0 flex-1 items-center gap-2.5">
              <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={allowed.includes(m.choice)} onChange={() => setAllowed(toggle(allowed, m.choice))} />
              <span className="flex flex-col">
                <span className="font-semibold">{name(m.choice)}</span>
                <span className="text-small text-ink-2">{m.choice === "private" ? `Your ${models.private?.kind === "own" ? "own trained" : "self-hosted open-source"} model` : m.simulated ? "Answered by Gemini in this prototype" : "Real in this prototype"}</span>
              </span>
            </label>
            {m.simulated && <SimTag />}
            {m.choice !== "private" && (
              <label className="flex items-center gap-2 text-small text-ink-2">
                <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={ownKeys.includes(m.choice)} onChange={() => setOwnKeys(toggle(ownKeys, m.choice))} />
                Bill our own key
              </label>
            )}
          </div>
        ))}
      </fieldset>
      <p className="text-small text-ink-2">&ldquo;Bill our own key&rdquo; is simulated: the prototype never stores a provider key, and Lyzr&apos;s keys answer either way.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.architect} className="text-small font-semibold text-ink-2">
            Architect&apos;s model (writes plans; new projects start on it)
          </label>
          <Select id={ids.architect} controlSize="md" value={architect} onChange={(e) => setArchitect(e.target.value as ModelChoice)}>
            {allowed.map((m) => (
              <option key={m} value={m}>
                {name(m)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.agents} className="text-small font-semibold text-ink-2">
            Default for app agents
          </label>
          <Select id={ids.agents} controlSize="md" value={agentDefault} onChange={(e) => setAgentDefault(e.target.value as ModelChoice)}>
            {allowed.map((m) => (
              <option key={m} value={m}>
                {name(m)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <PrivateModelCard models={models} onSaved={onSaved} />
      <ErrorLine error={error} />
    </DetailBody>
  );
}

function PrivateModelCard({ models, onSaved }: { models: ModelPolicy; onSaved: (n: string) => void }) {
  const [form, setForm] = useState({ name: "", url: "", kind: "open_source" as "own" | "open_source" });
  const { pending, error, run } = useSave(onSaved);
  const ids = { name: useId(), url: useId() };
  const pm = models.private;
  return (
    <section aria-labelledby="private-model" className="flex flex-col gap-2.5 rounded-card border border-line p-4">
      <h3 id="private-model" className="flex items-center gap-2 font-[650]">
        Your private model <SimTag title="No request reaches a private endpoint in this prototype: Gemini answers in its place." />
      </h3>
      {pm ? (
        <>
          <p>
            <strong className="font-semibold">{pm.name}</strong> · {pm.kind === "own" ? "your own trained model" : "an open-source model you host"} at <code className="font-mono text-small">{pm.url}</code>
          </p>
          <p className="text-small text-ink-2">Pick it above as Architect&apos;s model, the default for app agents, or both. In VPC and on-prem it runs inside your environment.</p>
          <Button className="self-start" disabledReason={pending ? "Removing…" : undefined} onClick={() => run(() => removePrivateModel(), `Removed ${pm.name}.`)}>
            Remove it
          </Button>
        </>
      ) : (
        <>
          <p className="text-small text-ink-2">Your organisation&apos;s own trained model, or an open-source model you host, at a private endpoint.</p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <label htmlFor={ids.name} className="flex flex-col gap-1 text-small font-semibold text-ink-2">
              Name
              <input id={ids.name} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme Llama 3.1 70B" className="min-h-[38px] rounded-[12px] border border-line-ctl bg-surface px-3 text-body font-normal text-ink" />
            </label>
            <label htmlFor={ids.url} className="flex flex-col gap-1 text-small font-semibold text-ink-2">
              Endpoint (https)
              <input id={ids.url} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://llm.acme.internal/v1" className="min-h-[38px] rounded-[12px] border border-line-ctl bg-surface px-3 font-mono text-small font-normal text-ink" />
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-4 text-small">
            <legend className="sr-only">What kind of model</legend>
            {(["open_source", "own"] as const).map((k) => (
              <label key={k} className="flex min-h-6 items-center gap-2">
                <input type="radio" name="private-kind" className="size-4 accent-[var(--ink)]" checked={form.kind === k} onChange={() => setForm({ ...form, kind: k })} />
                {k === "own" ? "Our own trained model" : "An open-source model we host"}
              </label>
            ))}
          </fieldset>
          <Button className="self-start" disabledReason={pending ? "Registering…" : !form.name.trim() || !form.url.trim() ? "Give it a name and an endpoint first." : undefined} onClick={() => run(() => registerPrivateModel(form), `Registered ${form.name.trim()}. It's allowed; pick it as Architect's model or the agents' default.`)}>
            Register model
          </Button>
        </>
      )}
      <ErrorLine error={error} />
    </section>
  );
}

/* ------------------------------------------------------------------ C-3 */

type McpForm = [{ name: string; url: string }, (f: { name: string; url: string }) => void];

function AppsEditor({ apps, known, onSaved, mcpForm, connections }: { apps: AppPolicy; known: string[]; onSaved: (n: string) => void; mcpForm: McpForm; connections: { id: string; url: string; connected: boolean; tools: number }[] }) {
  const [allow, setAllow] = useState<string[]>(apps.allow);
  const [scopes, setScopes] = useState<Record<string, Scope>>(Object.fromEntries(known.map((k) => [k, scopeOf(apps, k)])));
  const [who, setWho] = useState(apps.whoCanConnect);
  const { pending, error, run } = useSave(onSaved);
  const changed =
    allow.slice().sort().join() !== apps.allow.slice().sort().join() || who !== apps.whoCanConnect || allow.some((a) => scopes[a] !== scopeOf(apps, a));
  return (
    <DetailBody
      footer={
        <Button
          variant="primary"
          disabledReason={pending ? "Saving…" : changed ? undefined : "Nothing changed yet."}
          onClick={() => run(() => saveAppPolicy({ allow, whoCanConnect: who, scopes: Object.fromEntries(allow.map((a) => [a, scopes[a] ?? "read_write"])) }), "Saved. New builds follow the allowed list.")}
        >
          Save apps
        </Button>
      }
    >
      <DetailHead kicker={<>Organisation policy <SimTag title={SIM_NOTE} /></>} title="Which apps and MCP servers projects may use">
        A part that needs an app not on this list waits for an admin (&ldquo;Needs approval&rdquo;) and a request lands in Approvals. Parts already working keep working.
      </DetailHead>
      <fieldset className="flex flex-col rounded-card border border-line">
        <legend className="sr-only">Allowed apps</legend>
        {known.map((p, i) => {
          const on = allow.includes(p);
          return (
            <div key={p} className={cn("flex flex-wrap items-center gap-3 px-3.5 py-3", i > 0 && "border-t border-line")}>
              <label className="flex min-w-0 flex-1 items-center gap-2.5">
                <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={on} onChange={() => setAllow(on ? allow.filter((a) => a !== p) : [...allow, p])} />
                <span className="flex flex-col">
                  <span className="font-semibold">{providerName(p)}</span>
                  <span className="text-small text-ink-2">{on ? (PROVIDERS[p]?.what ?? "Used by a plan in this workspace.") : "Needs an admin's approval, per project or everywhere"}</span>
                </span>
              </label>
              {on && (
                <Select aria-label={`What ${providerName(p)} may do`} value={scopes[p] ?? "read_write"} onChange={(e) => setScopes({ ...scopes, [p]: e.target.value as Scope })}>
                  {(["read", "read_write"] as const).map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          );
        })}
      </fieldset>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-small font-semibold text-ink-2">Who can connect an allowed app</legend>
        {(
          [
            ["builders", "Anyone who can build", "Builders connect apps on the part that needs them."],
            ["admins", "Owners and Admins only", "Builders see Connect with the reason, and ask an admin."],
          ] as const
        ).map(([v, label, detail]) => (
          <label key={v} className="flex items-start gap-2.5">
            <input type="radio" name="who-connects" className="mt-1 size-4 accent-[var(--ink)]" checked={who === v} onChange={() => setWho(v)} />
            <span className="flex flex-col">
              <span className="font-semibold">{label}</span>
              <span className="text-small text-ink-2">{detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <ErrorLine error={error} />
      <McpCard apps={apps} onSaved={onSaved} formState={mcpForm} connections={connections} />
    </DetailBody>
  );
}

function McpCard({ apps, onSaved, formState, connections }: { apps: AppPolicy; onSaved: (n: string) => void; formState: McpForm; connections: { id: string; url: string; connected: boolean; tools: number }[] }) {
  const [form, setForm] = formState;
  const { pending, error, run } = useSave(onSaved);
  const ids = { name: useId(), url: useId() };
  return (
    <section aria-labelledby="mcp-servers" className="flex flex-col gap-2.5 rounded-card border border-line p-4">
      <h3 id="mcp-servers" className="font-[650]">
        MCP servers app agents may use
      </h3>
      <p className="text-small text-ink-2">Only servers on this list can be added in Connections, and agents pick from the ones added there.</p>
      {apps.mcp.length ? (
        <ul aria-label="Allowed MCP servers" className="flex flex-col divide-y divide-line rounded-card border border-line">
          {apps.mcp.map((m) => (
            <li key={m.name} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{m.name}</span>
                <code className="truncate font-mono text-small text-ink-2">{m.url}</code>
              </span>
              {(() => {
                // The Connections row for this server (M6), by URL.
                const c = connections.find((x) => normalizeMcpUrl(x.url) === normalizeMcpUrl(m.url));
                return c ? (
                  <TextLink className="text-small" href={`/connections#mcp-${c.id}`}>
                    {c.connected ? `In Connections · ${c.tools} ${c.tools === 1 ? "tool" : "tools"}` : "In Connections · not connected"}
                  </TextLink>
                ) : (
                  <TextLink className="text-small" href="/connections#mcp">
                    Add in Connections
                  </TextLink>
                );
              })()}
              <Button size="sm" variant="quiet" disabledReason={pending ? "Saving…" : undefined} onClick={() => run(() => removeMcpServer({ name: m.name }), `Removed ${m.name}.`)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-ink-2">None yet.</p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label htmlFor={ids.name} className="flex flex-col gap-1 text-small font-semibold text-ink-2">
          Name
          <input id={ids.name} value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Acme CRM tools" className="min-h-[38px] rounded-[12px] border border-line-ctl bg-surface px-3 text-body font-normal text-ink" />
        </label>
        <label htmlFor={ids.url} className="flex min-w-0 flex-1 flex-col gap-1 text-small font-semibold text-ink-2">
          URL (https)
          <input id={ids.url} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://mcp.acme.internal" className="min-h-[38px] rounded-[12px] border border-line-ctl bg-surface px-3 font-mono text-small font-normal text-ink" />
        </label>
        <Button
          className="self-start sm:self-auto"
          disabledReason={pending ? "Adding…" : !form.name.trim() || !form.url.trim() ? "Give it a name and a URL first." : undefined}
          onClick={() =>
            run(async () => {
              const r = await addMcpServer(form);
              if (r.ok) setForm({ name: "", url: "" });
              return r;
            }, `Added ${form.name.trim()}.`)
          }
        >
          Add server
        </Button>
      </div>
      <ErrorLine error={error} />
    </section>
  );
}

/* ------------------------------------------------------------------ C-4 */

function EgressEditor({ egress, flows, onSaved }: { egress: EgressPolicy; flows: ProjectFlows[]; onSaved: (n: string) => void }) {
  const [hosts, setHosts] = useState<string[]>(egress.hosts);
  const [redact, setRedact] = useState<Redaction[]>(egress.redact);
  const [host, setHost] = useState("");
  const [hostError, setHostError] = useState<string>();
  const held = flows.filter((f) => f.paths.some((p) => !p.allowed));
  const [projectId, setProjectId] = useState(held[0]?.id ?? flows[0]?.id ?? "");
  const { pending, error, run } = useSave(onSaved);
  const ids = { host: useId(), project: useId() };
  // What the flows would look like with the unsaved hosts, so an admin sees the effect before saving.
  const draft = egressOfDraft(hosts);
  const shown = flows.find((f) => f.id === projectId);
  const changed = hosts.join() !== egress.hosts.join() || redact.slice().sort().join() !== egress.redact.slice().sort().join();
  const add = () => {
    const problem = hostProblem(host, hosts);
    if (problem) return setHostError(problem);
    setHostError(undefined);
    setHosts([...hosts, host.trim().toLowerCase()]);
    setHost("");
  };
  return (
    <DetailBody
      footer={
        <Button variant="primary" disabledReason={pending ? "Saving…" : changed ? undefined : "Nothing changed yet."} onClick={() => run(() => saveEgress({ hosts, redact }), "Saved. Deploys check where data goes against the new list.")}>
          Save data rules
        </Button>
      }
    >
      <DetailHead kicker={<>Organisation policy <SimTag title={SIM_NOTE} /></>} title="Where data may go">
        Data may only go to the hosts below and to the models your organisation allows. A project that would send data anywhere else can&apos;t deploy, and its Launch page shows the path and the rule.
      </DetailHead>
      <section aria-labelledby="hosts" className="flex flex-col gap-2.5">
        <h3 id="hosts" className="font-[650]">
          Allowed hosts
        </h3>
        {hosts.length ? (
          <ul aria-label="Allowed hosts" className="flex flex-wrap gap-1.5">
            {hosts.map((h) => (
              <li key={h} className="inline-flex items-center gap-1 rounded-full bg-selected py-0.5 pr-1 pl-3 text-small font-semibold">
                <code className="font-mono">{h}</code>
                <button type="button" aria-label={`Remove ${h}`} onClick={() => setHosts(hosts.filter((x) => x !== h))} className="grid size-6 place-items-center rounded-full hover:bg-surface">
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-small text-ink-2">None: no app can send data anywhere.</p>
        )}
        <p className="text-small text-ink-2">A domain covers the hosts under it: googleapis.com covers gmail.googleapis.com.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label htmlFor={ids.host} className="flex min-w-0 flex-1 flex-col gap-1 text-small font-semibold text-ink-2">
            Add a host
            <input
              id={ids.host}
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
              placeholder="api.hubapi.com"
              className="min-h-[38px] rounded-[12px] border border-line-ctl bg-surface px-3 font-mono text-small font-normal text-ink"
            />
          </label>
          <Button className="self-start sm:self-auto" disabledReason={host.trim() ? undefined : "Type a host first."} onClick={add}>
            Add host
          </Button>
        </div>
        <ErrorLine error={hostError} />
      </section>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 font-[650]">Take out before anything goes to a model</legend>
        {REDACTIONS.map((r) => (
          <label key={r.id} className="flex min-h-6 items-center gap-2.5">
            <input type="checkbox" className="size-4 accent-[var(--ink)]" checked={redact.includes(r.id)} onChange={() => setRedact(redact.includes(r.id) ? redact.filter((x) => x !== r.id) : [...redact, r.id])} />
            {r.label}
          </label>
        ))}
        <p className="text-small text-ink-2">Apps get the data they need to work (a CRM lookup needs the email address); models get prompts with these taken out.</p>
      </fieldset>
      <section aria-labelledby="flows" className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="flows" className="flex-1 font-[650]">
            Where each project&apos;s data goes
          </h3>
          {flows.length > 0 && (
            <>
              <label htmlFor={ids.project} className="text-small font-semibold text-ink-2">
                Project
              </label>
              <Select id={ids.project} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {flows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.paths.some((p) => !p.allowed) ? " · held" : ""}
                  </option>
                ))}
              </Select>
            </>
          )}
        </div>
        {shown ? (
          <DataFlow project={shown.name} paths={shown.paths.map((p) => draft(p))} label={`Where ${shown.name}'s data goes`} />
        ) : (
          <p className="text-small text-ink-2">No projects yet.</p>
        )}
        {changed && <p className="text-small text-ink-2">Shown with your unsaved hosts. Save to apply them.</p>}
      </section>
      <ErrorLine error={error} />
    </DetailBody>
  );
}

/* ------------------------------------------------------------------ C-10 */

function RulesEditor({ permissions, onSaved }: { permissions: PermissionRules; onSaved: (n: string) => void }) {
  const [draft, setDraft] = useState<PermissionRules>(permissions);
  const { pending, error, run } = useSave(onSaved);
  const changed = PERMISSIONS.some((x) => draft[x.id] !== permissions[x.id]);
  return (
    <DetailBody
      footer={
        <Button variant="primary" disabledReason={pending ? "Saving…" : changed ? undefined : "Nothing changed yet."} onClick={() => run(() => savePermissionRules(draft), "Saved. The rules apply to people and to their coding agents.")}>
          Save rules
        </Button>
      }
    >
      <DetailHead kicker={<>Organisation policy <SimTag title={SIM_NOTE} /></>} title="What needs an Owner or Admin">
        Anything that leaves the sandbox runs only with an approval or a matching allow-rule; nothing is ever bypassed in bulk. The same rules apply to people&apos;s coding agents, through Architect&apos;s MCP server.
      </DetailHead>
      <div className="flex flex-col gap-3 rounded-card border border-line p-4">
        {PERMISSIONS.map((x) => (
          <Toggle
            key={x.id}
            checked={draft[x.id]}
            onCheckedChange={(on) => setDraft({ ...draft, [x.id]: on })}
            label={x.label}
            consequence={draft[x.id] ? `${x.effect} Owners and Admins go ahead.` : "Anyone who can build does it without asking."}
          />
        ))}
      </div>
      <p className="text-small text-ink-2">
        Coding-agent tokens and apps outside the allowed list always need an admin. Allow-rules made from approvals are in <TextLink href="/governance/approvals?tab=rules">Approvals › Rules</TextLink>.
      </p>
      <ErrorLine error={error} />
    </DetailBody>
  );
}

/* ------------------------------------------------------------------ C-7 */

function BudgetsEditor({ budget, projects, onSaved }: { budget: BudgetView; projects: ProjectBudget[]; onSaved: (n: string) => void }) {
  const [cap, setCap] = useState(budget.cap === null ? "" : String(budget.cap));
  const [caps, setCaps] = useState<Record<string, string>>(Object.fromEntries(projects.map((p) => [p.id, p.cap === null ? "" : String(p.cap)])));
  const { pending, error, run } = useSave(onSaved);
  const capId = useId();
  const num = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));
  const draftCap = num(cap);
  const state = budgetState(draftCap, budget.spent);
  const problem = cap.trim() !== "" && !Number.isFinite(Number(cap)) ? "Type a number of credits, or leave it empty for no cap." : capProblem(draftCap);
  const changed = draftCap !== budget.cap || projects.some((p) => num(caps[p.id] ?? "") !== p.cap);
  return (
    <DetailBody
      footer={
        <Button
          variant="primary"
          disabledReason={pending ? "Saving…" : problem ?? (changed ? undefined : "Nothing changed yet.")}
          onClick={() => run(() => saveBudgets({ monthlyCap: draftCap, projects: projects.map((p) => ({ id: p.id, cap: num(caps[p.id] ?? "") })) }), "Saved. Builders see the caps where they build.")}
        >
          Save budgets
        </Button>
      }
    >
      <DetailHead kicker={<>Organisation policy <SimTag title="Budgets are enforced on the simulated spend." /></>} title="How much the organisation spends">
        An alert shows everywhere at 80% of the monthly cap. At 100%, writing plans, Build, Apply and fixes stop until an Owner or Admin raises the cap; a Builder can ask for it in Approvals. What&apos;s built keeps working.
      </DetailHead>
      <div className="flex flex-col gap-2 rounded-card border border-line p-4">
        <label htmlFor={capId} className="text-small font-semibold text-ink-2">
          Monthly cap for the organisation (credits; empty for none)
        </label>
        <input id={capId} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="No cap" className="min-h-[38px] w-48 rounded-[12px] border border-line-ctl bg-surface px-3 text-body" />
        <p className="text-small text-ink-2 tabular-nums">
          This month: {budget.spent.toLocaleString("en-GB")} credits used of a {budget.allowance.toLocaleString("en-GB")}-credit allowance
          {draftCap ? ` · ${state.percent}% of the cap${state.level === "stopped" ? ": paid actions are stopped" : state.level === "alert" ? ": over the 80% alert" : ""}` : ""}.
        </p>
        {draftCap ? (
          <div className="h-2 overflow-hidden rounded-full bg-selected" role="img" aria-label={`${state.percent}% of the monthly cap used`}>
            <div className={cn("h-full rounded-full", state.level === "stopped" || state.level === "alert" ? "bg-attention" : "bg-ink")} style={{ width: `${Math.min(100, state.percent)}%` }} />
          </div>
        ) : null}
        <ErrorLine error={problem ?? undefined} />
      </div>
      <section aria-labelledby="project-caps" className="flex flex-col gap-2">
        <h3 id="project-caps" className="font-[650]">
          Cap per project
        </h3>
        <p className="text-small text-ink-2">A build pauses at its project&apos;s cap and keeps what works (the same as a budget set in the project).</p>
        <ul aria-label="Project caps" className="flex flex-col divide-y divide-line rounded-card border border-line">
          {projects.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{p.name}</span>
                <span className="text-small text-ink-2 tabular-nums">{p.spent.toLocaleString("en-GB")} credits used so far</span>
              </span>
              <label className="flex items-center gap-2 text-small text-ink-2">
                Cap
                <input aria-label={`Cap for ${p.name}`} inputMode="numeric" value={caps[p.id] ?? ""} onChange={(e) => setCaps({ ...caps, [p.id]: e.target.value })} placeholder="None" className="min-h-8 w-28 rounded-full border border-line-ctl bg-surface px-3 text-body text-ink" />
              </label>
            </li>
          ))}
        </ul>
        {!projects.length && <p className="text-small text-ink-2">No projects yet.</p>}
      </section>
      <ErrorLine error={error} />
    </DetailBody>
  );
}

/* ------------------------------------------------------------------ C-6 */

function AuditView({ entries }: { entries: AuditEntry[] }) {
  const [project, setProject] = useState("");
  const [person, setPerson] = useState("");
  const [by, setBy] = useState<AuditBy | "all">("all");
  const [query, setQuery] = useState("");
  const ids = { project: useId(), person: useId(), query: useId() };
  const projects = [...new Set(entries.map((e) => e.project).filter((p): p is string => Boolean(p)))].sort();
  const people = [...new Set(entries.filter((e) => e.by === "person").map((e) => e.actor))].sort();
  const shown = filterAudit(entries, { project: project || undefined, person: person || undefined, by, query });
  const download = () => {
    const blob = new Blob([auditCsv(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <DetailBody
      footer={
        <Button variant="primary" icon="download" disabledReason={shown.length ? undefined : "Nothing to export with these filters."} onClick={download}>
          Export CSV ({shown.length})
        </Button>
      }
    >
      <DetailHead data-tour="audit-log" kicker={<>Audit log <SimTag title="The log is real; the runs and deploys it records are simulated." /></>} title="Everything that happened">
        Every run, change, approval, policy change and deploy, newest first: the latest {entries.length}.
      </DetailHead>
      <div className="flex flex-wrap items-end gap-2.5">
        <label htmlFor={ids.project} className="flex flex-col gap-1 text-small font-semibold text-ink-2">
          Project
          <Select id={ids.project} value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor={ids.person} className="flex flex-col gap-1 text-small font-semibold text-ink-2">
          Person
          <Select id={ids.person} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor={ids.query} className="flex min-w-[160px] flex-1 flex-col gap-1 text-small font-semibold text-ink-2">
          Search
          <input id={ids.query} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="deploy, HubSpot, approved…" className="min-h-8 rounded-full border border-line-ctl bg-surface px-3.5 text-body font-normal text-ink" />
        </label>
      </div>
      <Segmented
        mode="filter"
        label="Done by"
        value={by}
        onChange={setBy}
        className="self-start"
        options={[
          { value: "all", label: "Anyone" },
          { value: "person", label: "People" },
          { value: "architect", label: "Architect" },
          { value: "coding_agent", label: "Coding agents" },
        ]}
      />
      {shown.length ? (
        <ul aria-label="Audit entries" className="flex flex-col divide-y divide-line rounded-card border border-line">
          {shown.slice(0, 200).map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 px-3.5 py-2.5">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <strong className="font-semibold">{e.what}</strong>
                <span className="text-small text-ink-2">{e.target}</span>
              </span>
              <span className="text-small text-ink-2">
                {e.actor} · {BY_LABEL[e.by]} · {new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC
                {e.details ? ` · ${e.details}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-2">{by === "coding_agent" ? "No coding-agent actions yet. They're logged when an agent acts through Architect's MCP server." : "Nothing matches these filters."}</p>
      )}
      {shown.length > 200 && <p className="text-small text-ink-2">Showing 200 of {shown.length}. Export CSV has them all.</p>}
    </DetailBody>
  );
}
