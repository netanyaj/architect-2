"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { SimTag } from "@/components/ax/pill";
import { Option } from "@/components/ax/stage-banner";
import { StatusWord } from "@/components/ax/status-mark";
import { Toggle } from "@/components/ax/toggle";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { ACCESS, CNAME_TARGET, MARKETPLACE_CATEGORIES, type Access, type DomainState, type Listing } from "@/lib/launch";
import { saveListing, setAccess, setAnalytics, setDomain } from "@/server/actions/launch";

type Env = "staging" | "production";
const ENV = { staging: "Team version", production: "Live" } as const;

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>, then?: () => void) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) setError(r.message);
      else then?.();
      router.refresh();
    });
  return { pending, error, act };
}

const Err = ({ text }: { text?: string }) =>
  text ? (
    <p role="alert" className="text-small font-semibold text-failed">
      {text}
    </p>
  ) : null;

/** Who can open it (review gap 2). */
export function AccessSetting({ projectId, value, domain, readOnly }: { projectId: string; value: Access; domain: string; readOnly?: string }) {
  const { pending, error, act } = useAct();
  return (
    <div className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold">Who can open it</span>
        <SimTag title="Access rules are simulated in this prototype" />
      </div>
      <div role="radiogroup" aria-label="Who can open it" className="flex flex-col gap-2">
        {(Object.keys(ACCESS) as Access[]).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={value === a}
            aria-disabled={readOnly || pending ? true : undefined}
            title={readOnly}
            onClick={() => !readOnly && value !== a && act(() => setAccess({ projectId, access: a }))}
            className={`flex flex-col items-start rounded-card border px-3.5 py-2.5 text-left ${value === a ? "border-2 border-ink bg-selected" : "border-line-ctl"} ${readOnly ? "cursor-not-allowed" : ""}`}
          >
            <span className="font-semibold">{a === "domain" ? `Signed-in people at @${domain}` : ACCESS[a].label}</span>
            <span className="text-small text-ink-2">{ACCESS[a].detail}</span>
          </button>
        ))}
      </div>
      <Err text={error} />
    </div>
  );
}

/** Custom domain steps (review gap 10): enter → add the CNAME → Checking → Secured, per version. */
function DomainDialog({ projectId, env, state, open, onOpenChange }: { projectId: string; env: Env; state?: DomainState; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { pending, error, act } = useAct();
  const [name, setName] = useState(state?.name ?? "");
  const inputId = useId();
  const step = state?.status ?? "enter";

  // While checking, ask the server one request at a time (every 1.5 s); refresh the page once, when it's secured.
  // Refreshing on every poll let a slow refresh be cancelled by the next one, so "Secured" never showed.
  const router = useRouter();
  useEffect(() => {
    if (!open || step !== "checking") return;
    let stopped = false;
    const poll = async () => {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, 1500));
        if (stopped) return;
        const r = await setDomain({ projectId, env, step: "verify" });
        if (!r.ok || r.status !== "checking") {
          router.refresh();
          return;
        }
      }
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [open, step, projectId, env, router]);

  const label = state?.name.split(".")[0] ?? "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[520px]">
        <DialogTitle className="text-sub font-semibold">Your own web address for the {ENV[env].toLowerCase()}</DialogTitle>
        <DialogDescription className="text-ink-2">
          {step === "enter" && "Use a domain your company owns. You'll add one record where you manage it."}
          {step === "dns" && "Add this record where you manage your domain, then come back and check it."}
          {step === "checking" && "Checking the record. This usually takes under a minute."}
          {step === "secured" && "Secured: the address works with HTTPS. The next deploy uses it."}
        </DialogDescription>
        <ol className="flex flex-wrap gap-2 text-small" aria-label="Steps">
          {(["Enter it", "Add the record", "Checking", "Secured"] as const).map((s, i) => {
            const at = ["enter", "dns", "checking", "secured"].indexOf(step);
            return (
              <li key={s} aria-current={i === at ? "step" : undefined} className={`rounded-full border px-2.5 py-0.5 ${i === at ? "border-ink font-semibold" : i < at ? "border-line text-ink-2" : "border-line text-ink-3"}`}>
                {i < at ? "✓ " : ""}
                {s}
              </li>
            );
          })}
        </ol>

        {step === "enter" && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act(() => setDomain({ projectId, env, step: "start", name }));
            }}
          >
            <label htmlFor={inputId} className="font-semibold">
              Web address
            </label>
            <input id={inputId} value={name} onChange={(e) => setName(e.target.value)} placeholder="prep.yourcompany.com" className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-3.5 font-mono" />
            <Err text={error} />
            <DialogFooter>
              <Button type="submit" variant="primary" disabledReason={pending ? "Saving…" : !name.trim() ? "Type the web address first." : undefined}>
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === "dns" && state && (
          <>
            <table className="w-full rounded-card border border-line text-left text-small">
              <thead>
                <tr className="text-ink-2">
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line font-mono">
                  <td className="px-3 py-2">CNAME</td>
                  <td className="px-3 py-2">{label}</td>
                  <td className="px-3 py-2">{CNAME_TARGET}</td>
                </tr>
              </tbody>
            </table>
            <Err text={error} />
            <DialogFooter className="gap-2">
              <Button variant="quiet" onClick={() => act(() => setDomain({ projectId, env, step: "remove" }))}>
                Use a different address
              </Button>
              <Button variant="primary" disabledReason={pending ? "Saving…" : undefined} onClick={() => act(() => setDomain({ projectId, env, step: "check" }))}>
                I&apos;ve added it · Check
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "checking" && (
          <p role="status" className="flex items-center gap-2 font-semibold text-building">
            <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            Checking {state?.name}… <SimTag />
          </p>
        )}

        {step === "secured" && state && (
          <>
            <p className="font-mono">{state.name}</p>
            <StatusWord status="works">Secured · HTTPS on</StatusWord>
            <DialogFooter className="gap-2">
              <Button variant="quiet" onClick={() => act(() => setDomain({ projectId, env, step: "remove" }))}>
                Remove it
              </Button>
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DomainSetting({ projectId, env, state, fallback, readOnly }: { projectId: string; env: Env; state?: DomainState; fallback: string; readOnly?: string }) {
  const [open, setOpen] = useState(false);
  const status = state ? { dns: "Waiting for the record", checking: "Checking", secured: "Secured" }[state.status] : null;
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Web address · {ENV[env]}</span>
        <span className="block truncate font-mono text-small text-ink-2">{state?.status === "secured" ? state.name : fallback}</span>
        {state && state.status !== "secured" && (
          <span className="block text-small text-ink-2">
            {state.name}: {status}
          </span>
        )}
      </span>
      <Button size="sm" disabledReason={readOnly} onClick={() => setOpen(true)}>
        {state ? (state.status === "secured" ? "Manage" : "Continue setup") : "Use your own domain"}
      </Button>
      {open && <DomainDialog projectId={projectId} env={env} state={state} open={open} onOpenChange={setOpen} />}
    </div>
  );
}

/** Analytics (review gap 12): opt-in, off by default. */
export function AnalyticsSetting({ projectId, on, readOnly }: { projectId: string; on: boolean; readOnly?: string }) {
  const { pending, error, act } = useAct();
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5">
      <Toggle
        checked={on}
        onCheckedChange={(next) => act(() => setAnalytics({ projectId, on: next }))}
        label="Built-in analytics"
        consequence="Visits and the pages people use, without personal data. Off by default, and stays off in private-cloud workspaces unless you turn it on."
        disabledReason={readOnly ?? (pending ? "Saving…" : undefined)}
      />
      <Err text={error} />
    </div>
  );
}

const SCOPES = { off: "Not listed", workspace: "Your workspace", public: "Public Agentlets" } as const;

/** Marketplace (review gap 4): your workspace or Public Agentlets, with today's listing form. */
export function MarketplaceSetting({ projectId, listing, isLive, readOnly, name }: { projectId: string; listing?: Listing; isLive: boolean; readOnly?: string; name: string }) {
  const { pending, error, act } = useAct();
  const [scope, setScope] = useState<Listing["scope"]>(listing?.scope ?? "off");
  const [category, setCategory] = useState<Listing["category"]>(listing?.category ?? "Productivity");
  const [description, setDescription] = useState(listing?.description ?? "");
  const [summary, setSummary] = useState(listing?.summary ?? "");
  const [tags, setTags] = useState((listing?.tags ?? []).join(", "));
  const [saved, setSaved] = useState(false);
  const ids = { cat: useId(), desc: useId(), sum: useId(), tags: useId() };
  const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
  const save = () =>
    act(
      () => saveListing({ projectId, listing: scope === "off" ? { scope, category, description: description || name, summary: summary || name, tags: [] } : { scope, category, description, summary, tags: tagList } }),
      () => setSaved(true),
    );

  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 font-semibold">Marketplace</span>
        {listing && listing.scope !== "off" && <StatusWord status="works">Listed in {SCOPES[listing.scope]}</StatusWord>}
        <SimTag title="The Marketplace listing is simulated in this prototype" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Where it's listed">
        {(Object.keys(SCOPES) as Listing["scope"][]).map((s) => (
          <Option key={s} selected={scope === s} onClick={() => !readOnly && setScope(s)}>
            {SCOPES[s]}
          </Option>
        ))}
      </div>
      <p className="text-small text-ink-2">
        {scope === "off" && "Only people who can open the app see it."}
        {scope === "workspace" && "People in your workspace can find it and copy it as a template."}
        {scope === "public" && "Anyone can find it in the public Agentlets directory and copy it. Your data never goes with it."}
      </p>
      {scope !== "off" && (
        <div className="grid grid-cols-1 gap-2.5">
          <label htmlFor={ids.cat} className="text-small font-semibold">
            Category
          </label>
          <select id={ids.cat} value={category} onChange={(e) => setCategory(e.target.value as Listing["category"])} className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-3">
            {MARKETPLACE_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <label htmlFor={ids.sum} className="flex justify-between text-small font-semibold">
            Short description <span className={`font-normal tabular-nums ${summary.length > 160 ? "text-failed" : "text-ink-3"}`}>{summary.length} / 160</span>
          </label>
          <input id={ids.sum} value={summary} onChange={(e) => setSummary(e.target.value)} className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-3.5" />
          <label htmlFor={ids.desc} className="text-small font-semibold">
            Description
          </label>
          <textarea id={ids.desc} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="rounded-card border border-line-ctl bg-surface px-3.5 py-2" />
          <label htmlFor={ids.tags} className="flex justify-between text-small font-semibold">
            Tags, separated by commas <span className={`font-normal tabular-nums ${tagList.length > 8 ? "text-failed" : "text-ink-3"}`}>{tagList.length} / 8</span>
          </label>
          <input id={ids.tags} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="meetings, sales, slack" className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-3.5" />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabledReason={readOnly ?? (pending ? "Saving…" : scope === "public" && !isLive ? "Go live first: the public directory lists live apps." : undefined)}
          onClick={save}
        >
          {scope === "off" ? "Save" : listing?.scope === scope ? "Update the listing" : `List in ${SCOPES[scope]}`}
        </Button>
        {saved && !error && (
          <span role="status" className="text-small text-ink-2">
            Saved.
          </span>
        )}
      </div>
      <Err text={error} />
    </div>
  );
}

/** For the settings section: a row that isn't built in this prototype yet. */
export function LaterRow({ title, detail, label, reason }: { title: string; detail: string; label: string; reason: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-small text-ink-2">{detail}</span>
      </span>
      <Button size="sm" disabledReason={reason}>
        {label}
      </Button>
    </div>
  );
}
