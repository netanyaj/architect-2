"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { SimTag } from "@/components/ax/pill";
import { StatusMark } from "@/components/ax/status-mark";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { KEY_ENV_LABEL, KEY_ENVS, type KeyCell, type KeyEnv, type KeyRow } from "@/lib/keys";
import { relativeTime } from "@/lib/project-status";
import { cn } from "@/lib/utils";
import { setProjectKey } from "@/server/actions/keys";

/**
 * Keys and passwords (C-10): per version, what's provided by Architect, set (by whom, when), waiting for an admin or
 * missing. Since M5.10 a value is stored encrypted at rest and never shown again; the apps that use it are simulated.
 */
export function KeysDialog({
  projectId,
  rows,
  open,
  onOpenChange,
  canSet,
  liveNeedsApproval,
}: {
  projectId: string;
  rows: KeyRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canSet: boolean;
  /** A key for Live waits for an Owner or Admin (governance, the rule on, a Builder). */
  liveNeedsApproval: boolean;
}) {
  const [editing, setEditing] = useState<{ name: string; env: KeyEnv } | null>(null);
  const [notice, setNotice] = useState<string>();
  return (
    <Dialog open={open} onOpenChange={(o) => (setEditing(null), setNotice(undefined), onOpenChange(o))}>
      <DialogContent className="max-h-[90dvh] overflow-auto rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[720px]">
        <div className="flex items-center gap-2">
          <DialogTitle className="flex-1 text-sub font-semibold">Keys and passwords</DialogTitle>
          <SimTag title="Values are stored encrypted. The apps that would use them are simulated in this prototype." />
        </div>
        <DialogDescription className="text-ink-2">
          Saved per version, never in the code, and stored encrypted. Once saved, a value is never shown again: you see that it&apos;s set, by whom and when.
        </DialogDescription>
        <p className="text-small font-semibold text-ink">Demo environment: use test values, not real secrets.</p>
        {notice && (
          <p role="status" className="rounded-card border-[1.5px] border-line px-4 py-2.5 font-semibold">
            {notice}
          </p>
        )}
        {rows.length ? (
          <ul aria-label="Keys" className="flex flex-col divide-y divide-line rounded-card border border-line">
            {rows.map((r) => (
              <li key={r.name} className="flex flex-col gap-2 px-3.5 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <code className="font-mono font-semibold">{r.name}</code>
                  <span className="text-small text-ink-2">{r.why}</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {KEY_ENVS.map((env) => (
                    <Cell
                      key={env}
                      env={env}
                      cell={r.cells[env]}
                      canSet={canSet}
                      onSet={() => (setEditing({ name: r.name, env }), setNotice(undefined))}
                    />
                  ))}
                </div>
                {editing?.name === r.name && (
                  <SetForm
                    projectId={projectId}
                    name={r.name}
                    env={editing.env}
                    waits={editing.env === "production" && liveNeedsApproval}
                    onDone={(n) => (setEditing(null), setNotice(n))}
                    onCancel={() => setEditing(null)}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-2">This app needs no keys yet. They show up here when a part needs one.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Cell({ env, cell, canSet, onSet }: { env: KeyEnv; cell: KeyCell; canSet: boolean; onSet: () => void }) {
  const word = cell.state === "auto" ? "Set" : cell.state === "set" ? "Set" : cell.state === "waiting" ? "Waiting for an admin" : "Not set";
  return (
    <div className="flex flex-col gap-1 rounded-tile bg-tray px-3 py-2">
      <span className="text-small font-semibold text-ink-2">{KEY_ENV_LABEL[env]}</span>
      <span className={cn("flex items-center gap-1.5 text-small font-semibold", cell.state === "missing" && env === "production" && "text-attention", cell.state === "waiting" && "text-approval")}>
        <StatusMark status={cell.state === "missing" ? (env === "production" ? "attention" : "todo") : cell.state === "waiting" ? "approval" : "works"} icon={cell.state === "missing" ? "dot" : cell.state === "waiting" ? "lock" : "check"} />
        {word}
      </span>
      <span className="text-small text-ink-2">{cell.by ? `${cell.by} · ${relativeTime(cell.at!)}` : (cell.note ?? "")}</span>
      {cell.state !== "auto" && cell.state !== "waiting" && (
        <Button size="sm" className="self-start" disabledReason={canSet ? undefined : "Viewers can't set keys."} onClick={onSet}>
          {cell.state === "set" ? "Replace" : "Set"}
        </Button>
      )}
    </div>
  );
}

/** "Live", "the test version", "the team version". */
const forEnv = (env: KeyEnv) => (env === "production" ? "Live" : `the ${KEY_ENV_LABEL[env].toLowerCase()}`);

function SetForm({ projectId, name, env, waits, onDone, onCancel }: { projectId: string; name: string; env: KeyEnv; waits: boolean; onDone: (note: string) => void; onCancel: () => void }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <form
      className="flex flex-col gap-2 rounded-card border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(undefined);
          const r = await setProjectKey({ projectId, name, environment: env, value });
          setValue("");
          if (!r.ok) return setError(r.message);
          onDone(r.waiting ? `${name} for Live is waiting for an Owner or Admin.` : `${name} is set for ${forEnv(env)}.`);
          router.refresh();
        });
      }}
    >
      <label htmlFor={id} className="text-small font-semibold text-ink-2">
        Value of {name} for {forEnv(env)}
      </label>
      <input id={id} type="password" autoComplete="off" value={value} onChange={(e) => setValue(e.target.value)} className="min-h-[38px] rounded-[12px] border border-line-ctl bg-surface px-3 font-mono text-small" />
      <p className="text-small text-ink-2">{waits ? "Your organisation's rule: a key for Live waits for an Owner or Admin. " : ""}The value is stored encrypted and never shown again.</p>
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" size="sm" disabledReason={pending ? "Saving…" : value ? undefined : "Type the value first."}>
          {waits ? "Ask an admin" : "Save key"}
        </Button>
        <Button size="sm" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
