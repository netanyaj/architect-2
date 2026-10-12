"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ax/button";
import { StatusLine } from "@/components/ax/status-mark";
import { relativeTime } from "@/lib/project-status";
import { removeLyzrKey, setLyzrKey } from "@/server/actions/lyzr-key";

export type LyzrCardStatus = { connected: false } | { connected: true; last4: string; setBy: string; setAt: string };

/**
 * Connections › Lyzr Studio (M5.10): each workspace connects its own Lyzr key, so its agents live in its own Studio.
 * Owners and Admins add or remove it; the key is never shown again, only its last 4 characters.
 */
export function LyzrCard({ status, isAdmin }: { status: LyzrCardStatus; isAdmin: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const inputId = useId();
  const errorId = useId();
  const connect = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(undefined);
      const r = await setLyzrKey({ value });
      if (!r.ok) return setError(r.message);
      setValue("");
      router.refresh();
    });
  };
  const remove = () =>
    start(async () => {
      setError(undefined);
      const r = await removeLyzrKey();
      if (!r.ok) return setError(r.message);
      router.refresh();
    });
  return (
    <section id="lyzr" aria-labelledby="lyzr-title" className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id="lyzr-title" className="text-sub font-semibold">
          Lyzr Studio
        </h2>
        <p className="text-small text-ink-2">
          Agents in your plans are made and run in this workspace&apos;s own Lyzr Studio, when their part is built. Each workspace uses its own Lyzr account; nobody else&apos;s agents or data are shared.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex-1 font-semibold">Your Lyzr key</span>
        {status.connected ? (
          <StatusLine status="works">Connected</StatusLine>
        ) : (
          <StatusLine status="todo">Not connected · Studio actions are simulated</StatusLine>
        )}
      </div>
      {status.connected ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex-1 text-small text-ink-2">
            Key ending <span className="font-mono text-ink">{status.last4}</span> · set by {status.setBy} · {relativeTime(status.setAt)}
          </span>
          {isAdmin && (
            <Button size="sm" variant="quiet" disabledReason={pending ? "Removing…" : undefined} onClick={remove}>
              Remove key
            </Button>
          )}
        </div>
      ) : isAdmin ? (
        <form onSubmit={connect} className="flex flex-col gap-1.5" noValidate>
          <label htmlFor={inputId} className="text-small font-semibold text-ink-2">
            Lyzr API key
          </label>
          <div className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch">
            <input
              id={inputId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="From Lyzr Studio › Account › API keys"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="min-h-[38px] min-w-0 flex-1 rounded-full border border-line-ctl bg-surface px-4 font-mono text-body text-ink placeholder:font-sans placeholder:text-ink-3"
            />
            <Button type="submit" disabledReason={pending ? "Checking the key…" : !value.trim() ? "Paste the key first." : undefined}>
              {pending ? "Checking the key…" : "Connect with your Lyzr API key"}
            </Button>
          </div>
          <p className="text-small text-ink-2">Checked with Lyzr, then stored encrypted. It&apos;s never shown again, only its last 4 characters.</p>
        </form>
      ) : (
        <p className="text-small text-ink-2">An Owner or Admin connects the workspace&apos;s Lyzr key.</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
      </div>
    </section>
  );
}
