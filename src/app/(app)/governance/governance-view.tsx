"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { DetailBody, DetailHead, MasterDetail, MasterRow } from "@/components/ax/master-detail";
import { SimTag, Tag } from "@/components/ax/pill";
import { Select } from "@/components/ax/select";
import { MODEL_LABEL, type ModelChoice, type ModelOption } from "@/lib/models";
import {
  AWS_REGIONS,
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
import { addMcpServer, registerPrivateModel, removeMcpServer, removePrivateModel, saveAppPolicy, saveLocation, saveModelPolicy } from "@/server/actions/policies";

export type Section = "location" | "models" | "apps";

const TITLES: Record<Section, string> = { location: "Where it runs", models: "Models", apps: "Apps and MCP servers" };
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
}) {
  const [section, setSection] = useState<Section>(props.initialSection);
  const [notice, setNotice] = useState<string>();
  // Kept here: saving the apps reloads that form, and what's being typed for a new MCP server must survive it.
  const mcpForm = useState({ name: "", url: "" });
  const lines = summaries(props);
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
      {section === "apps" && <AppsEditor key={JSON.stringify([props.apps, props.known])} apps={props.apps} known={props.known} onSaved={setNotice} mcpForm={mcpForm} />}
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

function AppsEditor({ apps, known, onSaved, mcpForm }: { apps: AppPolicy; known: string[]; onSaved: (n: string) => void; mcpForm: McpForm }) {
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
      <McpCard apps={apps} onSaved={onSaved} formState={mcpForm} />
    </DetailBody>
  );
}

function McpCard({ apps, onSaved, formState }: { apps: AppPolicy; onSaved: (n: string) => void; formState: McpForm }) {
  const [form, setForm] = formState;
  const { pending, error, run } = useSave(onSaved);
  const ids = { name: useId(), url: useId() };
  return (
    <section aria-labelledby="mcp-servers" className="flex flex-col gap-2.5 rounded-card border border-line p-4">
      <h3 id="mcp-servers" className="font-[650]">
        MCP servers app agents may use
      </h3>
      <p className="text-small text-ink-2">Agents pick these in Settings › Tools. A server not on this list can&apos;t be added to an agent.</p>
      {apps.mcp.length ? (
        <ul aria-label="Allowed MCP servers" className="flex flex-col divide-y divide-line rounded-card border border-line">
          {apps.mcp.map((m) => (
            <li key={m.name} className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{m.name}</span>
                <code className="truncate font-mono text-small text-ink-2">{m.url}</code>
              </span>
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
