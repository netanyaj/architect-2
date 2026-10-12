"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { ListRow, Tray } from "@/components/ax/list-row";
import { Tag } from "@/components/ax/pill";
import { StatusLine } from "@/components/ax/status-mark";
import { clearApiKey, connectProvider, setApiKey } from "@/server/actions/connections";

export type ConnectionRow = {
  id: string;
  /** Signing in (OAuth), or a key (BL-9). */
  kind: "oauth" | "api_key";
  /** An API key that's set: who set it and when ("Jordan (IT) · 3 days ago"). */
  setBy?: string;
  name: string;
  what: string;
  usedBy: string[];
  state: "connected" | "missing" | "expired" | "blocked" | "waiting";
  /** What the organisation lets it do (C-3), with governance on. */
  scope?: string;
};

type Access = { canConnect: boolean; refusal?: string; isAdmin: boolean };

function Row({ c, access }: { c: ConnectionRow; access: Access }) {
  if (c.kind === "api_key") return <KeyRow c={c} access={access} />;
  return <OauthRow c={c} access={access} />;
}

/** An API key connection: Set (by whom, when) or Not set. The key itself is never stored or shown. */
function KeyRow({ c, access }: { c: ConnectionRow; access: Access }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [replacing, setReplacing] = useState(false);
  const used = c.usedBy.length ? `Used by ${c.usedBy.join(", ")}` : "Not used by a project yet";
  const status =
    c.state === "connected" ? (
      <StatusLine status="works">Set</StatusLine>
    ) : c.state === "blocked" ? (
      <StatusLine status="blocked" icon="lock">
        Not allowed by policy
      </StatusLine>
    ) : (
      <StatusLine status="attention" icon="plug">
        Not set
      </StatusLine>
    );
  return (
    <ListRow
      icon="connections"
      name={
        <span className="flex flex-wrap items-center gap-2">
          {c.name} <Tag>API key</Tag>
        </span>
      }
      meta={
        <>
          {c.what} {used}.{c.setBy ? ` Set by ${c.setBy}.` : ""}
        </>
      }
      status={status}
      trailing={
        c.state === "blocked" ? null : c.state === "connected" ? (
          <span className="flex gap-1.5">
            <Button size="sm" disabledReason={access.canConnect ? undefined : "Viewers can't change keys."} onClick={() => setReplacing(true)}>
              Replace key
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabledReason={!access.canConnect ? "Viewers can't remove keys." : pending ? "Removing…" : undefined}
              onClick={() =>
                start(async () => {
                  const r = await clearApiKey({ connectionId: c.id });
                  if (!r.ok) setError(r.message);
                  else router.refresh();
                })
              }
            >
              Remove
            </Button>
          </span>
        ) : (
          <Button size="sm" disabledReason={access.canConnect ? access.refusal : "Viewers can't add keys."} onClick={() => setReplacing(true)}>
            Add the key
          </Button>
        )
      }
      footer={
        replacing ? (
          <KeyForm fixedName={c.name} onDone={() => setReplacing(false)} />
        ) : error ? (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        ) : undefined
      }
    />
  );
}

/** Paste a key: it's checked and thrown away; the row records only that it's set (Simulated). */
function KeyForm({ fixedName, onDone }: { fixedName?: string; onDone: () => void }) {
  const router = useRouter();
  const ids = { name: useId(), value: useId() };
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const form = useRef<HTMLFormElement>(null);
  // Cancel clears what was typed and any error, then closes.
  const cancel = () => {
    form.current?.reset();
    setError(undefined);
    onDone();
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    start(async () => {
      setError(undefined);
      const r = await setApiKey({ name: fixedName ?? String(f.get("name") ?? ""), value: String(f.get("value") ?? "") });
      if (!r.ok) return setError(r.message);
      onDone();
      router.refresh();
    });
  };
  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {!fixedName && (
          <span className="flex flex-col gap-1">
            <label htmlFor={ids.name} className="text-small font-semibold">
              Service
            </label>
            <input id={ids.name} name="name" placeholder="Clearbit" maxLength={40} autoComplete="off" className="min-h-8 w-44 rounded-full border border-line-ctl bg-surface px-3" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={ids.value} className="text-small font-semibold">
            {fixedName ? `${fixedName} API key` : "API key"}
          </label>
          <input id={ids.value} name="value" type="password" autoComplete="off" spellCheck={false} className="min-h-8 w-full rounded-full border border-line-ctl bg-surface px-3 font-mono" />
        </span>
        <Button size="sm" type="submit" disabledReason={pending ? "Saving…" : undefined}>
          {pending ? "Saving…" : "Save key"}
        </Button>
        <Button size="sm" variant="quiet" onClick={cancel}>
          Cancel
        </Button>
      </div>
      <p className="text-small text-ink-2">The key is checked and thrown away: Architect records only that it&apos;s set, by you, now.</p>
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * Apps (M6): the sign-in and API-key apps your plans use, with "Add an API key" in the section's header for a service
 * that has no row yet.
 */
export function AppsSection({ canAdd, refusal, children }: { canAdd: boolean; refusal?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section id="apps" aria-labelledby="apps-title" className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="apps-title" className="text-sub font-semibold">
            Apps
          </h2>
          <p className="text-small text-ink-2">Apps your plans sign in to, or use with an API key. Each shows what it&apos;s used for.</p>
        </div>
        {canAdd && !open && (
          <Button icon="plus" disabledReason={refusal} onClick={() => setOpen(true)}>
            Add an API key
          </Button>
        )}
      </div>
      {open && (
        <div className="rounded-card border border-line bg-surface px-4 py-3.5">
          <KeyForm onDone={() => setOpen(false)} />
        </div>
      )}
      {children}
    </section>
  );
}

function OauthRow({ c, access }: { c: ConnectionRow; access: Access }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const used = c.usedBy.length ? `Used by ${c.usedBy.join(", ")}` : "Not used by a project yet";

  const status =
    c.state === "connected" ? (
      <StatusLine status="works">Connected</StatusLine>
    ) : c.state === "waiting" ? (
      <StatusLine status="approval" icon="lock">
        Waiting for IT approval
      </StatusLine>
    ) : c.state === "blocked" ? (
      <StatusLine status="blocked" icon="lock">
        Not allowed by policy
      </StatusLine>
    ) : (
      <StatusLine status="attention" icon="plug">
        {c.state === "expired" ? "Needs you: reconnect" : "Not connected"}
      </StatusLine>
    );

  const action =
    c.state === "missing" || c.state === "expired" ? (
      <Button
        size="sm"
        disabledReason={pending ? "Connecting…" : !access.canConnect ? "Viewers can't connect apps." : access.refusal}
        onClick={() =>
          start(async () => {
            setError(undefined);
            const r = await connectProvider({ connectionId: c.id });
            if (!r.ok) setError(r.message);
          })
        }
      >
        {pending ? "Connecting…" : `Connect ${c.name}`}
      </Button>
    ) : c.state === "waiting" && access.isAdmin ? (
      <TextLink href="/governance/approvals">See request</TextLink>
    ) : null;

  return (
    <ListRow
      icon="connections"
      name={c.name}
      meta={
        <>
          {c.what} {used}.{c.scope ? ` Allowed: ${c.scope.toLowerCase()}.` : ""}
        </>
      }
      status={status}
      trailing={action}
      footer={
        error ? (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        ) : (c.state === "missing" || c.state === "expired") && access.canConnect && access.refusal ? (
          <p className="text-small text-ink-2">{access.refusal}</p>
        ) : undefined
      }
    />
  );
}

export function ConnectionsList({ rows, access }: { rows: ConnectionRow[]; access: Access }) {
  // Needs attention first, then the rest.
  const order = { missing: 0, expired: 0, waiting: 1, blocked: 2, connected: 3 };
  return (
    <Tray label="Connections">
      {[...rows].sort((a, b) => order[a.state] - order[b.state]).map((c) => (
        <Row key={c.id} c={c} access={access} />
      ))}
    </Tray>
  );
}
