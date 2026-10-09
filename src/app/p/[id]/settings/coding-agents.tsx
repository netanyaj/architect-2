"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { SimTag } from "@/components/ax/pill";
import { StatusWord } from "@/components/ax/status-mark";
import { DEFAULT_SCOPES, SCOPES, type Scope } from "@/lib/mcp";
import { approveProjectToken, createProjectToken, revokeProjectToken } from "@/server/actions/tokens";

export type TokenRow = { id: string; name: string; scopes: string[]; last4: string; status: "waiting" | "active" | "revoked"; createdAt: string; rejected?: { by: string; reason: string | null } | null };

/**
 * Project settings › Coding agents (F4): make a scoped, revocable project token for Claude Code, Cursor or another
 * coding agent. Simulated: the token is shown once, but no server accepts it in this prototype.
 */
export function CodingAgents({ projectId, tokens, governance, canCreate, canApprove }: { projectId: string; tokens: TokenRow[]; governance: boolean; canCreate: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>(DEFAULT_SCOPES);
  const [shown, setShown] = useState<{ token: string; status: "waiting" | "active" } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const nameId = useId();
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) setError(r.message);
      router.refresh();
    });
  const create = () =>
    start(async () => {
      setError(undefined);
      const r = await createProjectToken({ projectId, name, scopes });
      if (!r.ok) return setError(r.message);
      setShown({ token: r.token, status: r.status });
      setName("");
      router.refresh();
    });
  const reason = !canCreate ? "Viewers can't make tokens." : !name.trim() ? "Name the token first." : !scopes.length ? "Pick at least one thing the agent may do." : pending ? "Making the token…" : undefined;

  return (
    <section aria-labelledby="coding-agents" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="coding-agents" className="flex-1 text-heading font-[650]">
          Coding agents
        </h2>
        <SimTag title="Tokens are simulated: no server accepts them in this prototype." />
      </div>
      <p className="text-ink-2">
        Let Claude Code, Cursor or another coding agent work on this project through Architect&apos;s MCP server. It works on a branch, every change it makes waits for its
        check, and only the checker can mark a part Works. <Link href="/docs/mcp" className="font-semibold text-ink underline decoration-line-ctl underline-offset-[3px]">How to connect it</Link>
      </p>

      <div className="flex flex-col gap-3 rounded-card border border-line p-4">
        <label htmlFor={nameId} className="text-small font-semibold text-ink-2">
          Token name
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="e.g. Sam's Claude Code"
          className="min-h-[38px] rounded-tile border border-line-ctl bg-surface px-3 text-body"
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-small font-semibold text-ink-2">What the agent may do</legend>
          {SCOPES.map((s) => (
            <label key={s.id} className="flex min-h-7 items-center gap-2.5">
              <input type="checkbox" checked={scopes.includes(s.id)} onChange={(e) => setScopes((all) => (e.target.checked ? [...all, s.id] : all.filter((x) => x !== s.id)))} />
              <span>{s.label}</span>
              <code className="font-mono text-small text-ink-3">{s.tools.join(", ")}</code>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" disabledReason={reason} onClick={create}>
            Make a token
          </Button>
          <span className="text-small text-ink-2">{governance ? "Governance is on: an Owner or Admin approves it before it works." : "It works as soon as it's made."}</span>
        </div>
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
      </div>

      {shown && (
        <section aria-label="Your new token" className="flex flex-col gap-2 rounded-card border-[1.5px] border-ink p-4">
          <p className="font-semibold">Copy this token now. It isn&apos;t shown again.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-tile bg-tray px-3 py-2 font-mono text-small break-all">{shown.token}</code>
            <Button
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(shown.token);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-small text-ink-2">
            {shown.status === "waiting" ? "It works once an Owner or Admin approves it. " : ""}In this prototype no server accepts it: the session in ?sim=byoagent shows what a coding agent would do.
          </p>
        </section>
      )}

      {tokens.length > 0 ? (
        <ul aria-label="Tokens" className="flex flex-col divide-y divide-line rounded-card border border-line">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 p-3.5">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{t.name}</span>
                <span className="text-small text-ink-2">
                  <code className="font-mono">ax_pt_…{t.last4}</code> · {t.scopes.map((s) => SCOPES.find((x) => x.id === s)?.label ?? s).join(" · ")}
                </span>
              </span>
              {t.status === "active" ? (
                <StatusWord status="works">Active</StatusWord>
              ) : t.status === "waiting" ? (
                <StatusWord status="approval">Waiting for approval</StatusWord>
              ) : (
                <span className="text-small text-ink-2">{t.rejected ? `Not approved by ${t.rejected.by}: ${t.rejected.reason ?? "no reason given"}` : "Revoked"}</span>
              )}
              {t.status === "waiting" && canApprove && (
                <Button size="sm" disabledReason={pending ? "Saving…" : undefined} onClick={() => act(() => approveProjectToken({ tokenId: t.id }))}>
                  Approve
                </Button>
              )}
              {t.status !== "revoked" && (
                <Button size="sm" variant="quiet" disabledReason={!canCreate ? "Viewers can't revoke tokens." : pending ? "Saving…" : undefined} onClick={() => act(() => revokeProjectToken({ tokenId: t.id }))}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-2">No tokens yet.</p>
      )}
    </section>
  );
}
