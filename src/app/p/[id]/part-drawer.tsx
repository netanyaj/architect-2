"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { Drawer } from "@/components/ax/drawer";
import { SimTag } from "@/components/ax/pill";
import { StatusMark } from "@/components/ax/status-mark";
import { canBuild } from "@/lib/permissions";
import { providerAccount } from "@/lib/providers";
import { useUi } from "@/lib/ui-store";
import { acceptSuggestion, loadPart, retryPart, setPartAside, type PartDetail } from "@/server/actions/run";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";
import { rowFor } from "./build-stage";
import { ConnectButton } from "./connect-button";

const CHECK_KIND: Record<string, string> = { ui_test: "UI test", api_test: "API test", type_check: "Type check", http: "HTTP check", eval: "Eval", rubric: "Rubric" };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Bold the numbers in a check, as on screen 6 ("under **200 words**"). */
function CheckText({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,.]*\s*(?:words|seconds|minutes|items|%)?)/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p))}</>;
}

/**
 * A part on demand (screen 6 and every other part): its check, written before the code, each attempt with its cost,
 * and what to do next. A Blocked part leads with the suggested fix.
 */
export function PartDrawer({ project, items }: { project: ProjectWorkspace; items: WorkspaceItem[] }) {
  const router = useRouter();
  const { partKey, openPart, openHelp, sendToChat } = useUi();
  const part = items.find((i) => i.key === partKey) ?? null;
  const [detail, setDetail] = useState<PartDetail | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const canAct = canBuild(project.role);
  // A part can show Blocked while the rest of the build plays; its choices open once the run settles.


  // Reload when the part's state changes, and once its run settles (proofs are written then).
  const statusKey = part ? `${part.id}:${part.status}:${project.run?.status ?? ""}:${project.run?.events.length ?? 0}` : null;
  // Keyed on the part's id, not the object: the build's clock re-renders every second, and a slow answer
  // must not be thrown away by the next tick.
  const partId = part?.id ?? null;
  useEffect(() => {
    if (!partId || loadedFor === statusKey) return;
    let stale = false;
    void loadPart({ itemId: partId }).then((r) => {
      if (stale) return;
      setDetail(r.ok ? r.detail : null);
      setLoadedFor(statusKey);
    });
    return () => {
      stale = true;
    };
  }, [partId, statusKey, loadedFor]);

  if (!part) return null;
  const blocked = part.status === "paused";
  const d = loadedFor === statusKey ? detail : null;
  // A-9: the choices work at once, even while the other parts keep building.
  const viewerReason = !canAct ? "Viewers can't change the build." : undefined;
  const close = () => {
    openPart(null);
    setError(undefined);
  };
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) return setError(r.message);
      close();
      router.refresh();
    });

  const row = rowFor(part);
  const fixes = d?.attempts.filter((a) => a.attempt > 0) ?? [];
  const title = blocked ? `${part.title} is blocked` : part.title;
  const state = blocked
    ? "Its check failed 3 times, so I stopped to protect your credits. Everything else keeps working."
    : part.status === "needs_connection"
      ? `Built and checked with sample data. Connect your ${providerAccount(part.provider)} and it uses yours.`
      : part.status === "needs_approval"
        ? "Waiting for IT to approve this service. Everything else keeps building."
        : (row.detail ?? (part.status === "built" ? "Works. Its check passed." : "Not built yet."));

  const footer = blocked ? (
    <>
      {d?.suggestion && (
        <Button variant="primary" disabledReason={viewerReason ?? (pending ? "Saving…" : undefined)} onClick={() => act(() => acceptSuggestion({ itemId: part.id }))}>
          {d.suggestion.button}
        </Button>
      )}
      <Button
        disabledReason={viewerReason}
        onClick={() => {
          sendToChat(`Change ${part.title}: `);
          close();
        }}
      >
        Edit this part
      </Button>
      <Button disabledReason={viewerReason ?? (pending ? "Starting…" : undefined)} onClick={() => act(() => retryPart({ itemId: part.id }))}>
        Try once more · ~{d?.retryCost ?? 3} cr
      </Button>
      <Button variant="quiet" disabledReason={viewerReason} onClick={() => act(() => setPartAside({ itemId: part.id }))}>
        Set aside for now
      </Button>
      <div className="flex w-full flex-wrap gap-4 pt-1">
        <TextLink href={`/p/${project.id}/launch#history`}>History and go back</TextLink>
        <TextLink onClick={() => openHelp(project.id)}>Ask a person about this</TextLink>
      </div>
    </>
  ) : part.status === "needs_connection" ? (
    <ConnectButton itemId={part.id} provider={part.provider} variant="primary" size="md" disabledReason={viewerReason} onDone={close} policy={project.policy} />
  ) : part.status === "built" || part.status === "sample_data" ? (
    <TextLink href={`/p/${project.id}/launch#history`}>History and go back</TextLink>
  ) : undefined;

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && close()}
      icon={<StatusMark status={row.status} icon={row.icon} className="mt-1 size-7" />}
      title={title}
      state={state}
      footer={
        footer || error ? (
          <>
            {footer}
            {error && (
              <p role="alert" className="w-full text-small font-semibold text-failed">
                {error}
              </p>
            )}
          </>
        ) : undefined
      }
    >
      <section className="rounded-card border border-line bg-tray px-4 py-3">
        <h3 className="flex items-center gap-2 text-small font-semibold text-ink-2">
          The check
          {d?.check && <span className="font-normal">· {CHECK_KIND[d.check.kind] ?? d.check.kind}</span>}
        </h3>
        <p className="mt-1">
          <CheckText text={part.provedWhen} />
        </p>
        {d?.check && (
          <p className="mt-1 text-small text-ink-2">
            Written by the {d.check.writtenBy === "verifier" ? "verifier" : d.check.writtenBy} at {time(d.check.writtenAt)}, before the code.
          </p>
        )}
      </section>

      {blocked && fixes.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">What I tried</h3>
          <ol className="flex flex-col gap-2.5">
            {fixes.map((a) => (
              <li key={`${a.attempt}-${a.at}`} className="flex items-start gap-2.5">
                <StatusMark status={a.result === "pass" ? "works" : "failed"} />
                <span className="flex-1">{a.note ?? `Fix ${a.attempt}`}</span>
                <span className="text-small text-ink-2 tabular-nums">
                  {(a.summary ?? "").replace(/^Failed: /, "")}
                  {a.credits !== null ? ` · ${a.credits} cr` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {blocked && d?.suggestion && (
        <section className="rounded-card border-[1.5px] border-ink px-4 py-3">
          <h3 className="text-small font-semibold text-ink-2">What I suggest</h3>
          <p className="mt-1 font-semibold">{d.suggestion.title}</p>
          <p className="mt-1 text-small text-ink-2">{d.suggestion.why}</p>
        </section>
      )}

      {!blocked && d && d.attempts.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-2 font-semibold">
            Proof <SimTag title="Checks run in the simulated build" />
          </h3>
          <ol className="flex flex-col gap-2">
            {d.attempts.map((a) => (
              <li key={`${a.attempt}-${a.at}`} className="flex items-start gap-2.5">
                <StatusMark status={a.result === "pass" ? "works" : "failed"} />
                <span className="flex-1">
                  {a.attempt === 0 ? "First build" : (a.note ?? `Fix ${a.attempt}`)}
                  <span className="block text-small text-ink-2">{a.summary}</span>
                </span>
                <span className="text-small text-ink-2 tabular-nums">
                  {time(a.at)}
                  {a.credits !== null ? ` · ${a.credits} cr` : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {d && d.credits > 0 && <p className="text-small text-ink-2 tabular-nums">Spent on this part: {Math.round(d.credits)} credits.</p>}
      {!d && <p className="text-small text-ink-2">Loading the part…</p>}
    </Drawer>
  );
}
