"use client";

import { useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { ListRow, Tray } from "@/components/ax/list-row";
import { StatusLine } from "@/components/ax/status-mark";
import { connectProvider } from "@/server/actions/connections";

export type ConnectionRow = {
  id: string;
  name: string;
  what: string;
  usedBy: string[];
  state: "connected" | "missing" | "expired" | "blocked" | "waiting";
  /** What the organisation lets it do (C-3), with governance on. */
  scope?: string;
};

type Access = { canConnect: boolean; refusal?: string; isAdmin: boolean };

function Row({ c, access }: { c: ConnectionRow; access: Access }) {
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
