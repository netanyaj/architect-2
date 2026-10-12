"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ax/button";
import { StatusLine } from "@/components/ax/status-mark";
import type { McpConnection } from "@/lib/mcp-connections";
import { relativeTime } from "@/lib/project-status";
import type { McpServer } from "@/lib/policies";
import { addMcpServer, removeMcpServer, testMcpConnection } from "@/server/actions/mcp";

// Name, URL and auth header all use the body font, for the text and the placeholders.
const inputClasses = "min-h-[38px] w-full rounded-full border border-line-ctl bg-surface px-4 font-sans text-body text-ink placeholder:font-sans placeholder:text-ink-3";

function ServerRow({ s, canAct }: { s: McpConnection; canAct: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) setError(r.message);
      router.refresh();
    });
  return (
    <li id={`mcp-${s.id}`} className="flex scroll-mt-6 flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{s.name}</span>
          <span className="truncate font-mono text-small text-ink-2">{s.url}</span>
        </span>
        {s.connected ? (
          <StatusLine status="works">
            Connected · {s.tools.length} {s.tools.length === 1 ? "tool" : "tools"}
          </StatusLine>
        ) : s.checkedAt ? (
          <StatusLine status="failed" icon="alert">
            Didn&apos;t connect
          </StatusLine>
        ) : (
          <StatusLine status="todo">Not tested yet</StatusLine>
        )}
        {canAct && (
          <>
            <Button size="sm" disabledReason={pending ? "Testing…" : undefined} onClick={() => act(() => testMcpConnection({ connectionId: s.id }))}>
              {pending ? "Testing…" : "Test connection"}
            </Button>
            <Button size="sm" variant="quiet" disabledReason={pending ? "Wait for the test." : undefined} onClick={() => act(() => removeMcpServer({ connectionId: s.id }))}>
              Remove
            </Button>
          </>
        )}
      </div>
      {s.connected && s.tools.length > 0 && (
        <ul aria-label={`${s.name} tools`} className="flex flex-wrap gap-1.5">
          {s.tools.map((t) => (
            <li key={t} className="rounded-full bg-selected px-2.5 font-mono text-small leading-6 text-ink">
              {t}
            </li>
          ))}
        </ul>
      )}
      <p className="text-small text-ink-2" role="status">
        {s.checkedAt ? `${s.connected ? "Checked" : `${s.error ?? "Server didn't answer."} Checked`} ${relativeTime(s.checkedAt)}.` : "Test it to see its tools."}
      </p>
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * MCP servers (M6, PRD BL-9): add one by name and HTTPS URL, with an optional auth header (stored encrypted, never shown
 * again). Test connection is real: MCP initialize + tools/list. With governance on, only servers on the organisation's
 * list can be added; agents pick from the servers here.
 */
export function McpServers({ servers, canAct, refusal, governance, allowed }: { servers: McpConnection[]; canAct: boolean; refusal?: string; governance: boolean; allowed: McpServer[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [header, setHeader] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const ids = { name: useId(), url: useId(), header: useId(), error: useId() };
  const notAdded = allowed.filter((a) => !servers.some((s) => s.url.replace(/\/+$/, "").toLowerCase() === a.url.replace(/\/+$/, "").toLowerCase()));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    start(async () => {
      setError(undefined);
      const r = await addMcpServer({ name, url, authHeader: header || undefined });
      if (!r.ok) return setError(r.message);
      setName("");
      setUrl("");
      setHeader("");
      setOpen(false);
      router.refresh();
    });
  };
  const addReason = !canAct ? "Viewers can't add MCP servers." : refusal;
  const cancel = () => {
    setName("");
    setUrl("");
    setHeader("");
    setError(undefined);
    setOpen(false);
  };
  return (
    <section id="mcp" aria-labelledby="mcp-title" className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="mcp-title" className="text-sub font-semibold">
            MCP servers
          </h2>
          <p className="text-small text-ink-2">
            Tools your agents can use. Test connection is real: Architect asks the server for its tools. Agents calling them is simulated in this prototype.
            {governance && " Your organisation allows only the servers on its list, in Governance › Apps and MCP servers."}
          </p>
        </div>
        {!open && (
          <Button icon="plus" disabledReason={addReason} onClick={() => setOpen(true)}>
            Add an MCP server
          </Button>
        )}
      </div>
      {open && (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-card border border-line bg-surface px-4 py-3.5" noValidate>
          {governance && notAdded.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-small text-ink-2">
              On your organisation&apos;s list:
              {notAdded.map((a) => (
                <Button key={a.url} size="sm" variant="quiet" onClick={() => (setName(a.name), setUrl(a.url))}>
                  {a.name}
                </Button>
              ))}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label htmlFor={ids.name} className="flex flex-col gap-1.5 text-small font-semibold text-ink-2">
              Name
              <input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Company docs" className={inputClasses} />
            </label>
            <label htmlFor={ids.url} className="flex flex-col gap-1.5 text-small font-semibold text-ink-2">
              URL
              <input id={ids.url} value={url} onChange={(e) => setUrl(e.target.value)} type="url" inputMode="url" spellCheck={false} placeholder="https://mcp.example.com/mcp" className={inputClasses} />
            </label>
          </div>
          <label htmlFor={ids.header} className="flex flex-col gap-1.5 text-small font-semibold text-ink-2">
            Auth header (optional)
            <input id={ids.header} value={header} onChange={(e) => setHeader(e.target.value)} type="password" autoComplete="off" spellCheck={false} placeholder="Authorization: Bearer …" aria-describedby={error ? ids.error : undefined} className={inputClasses} />
          </label>
          <p className="text-small text-ink-2">HTTPS only. The header is stored encrypted and never shown again. Adding it runs one test.</p>
          {error && (
            <p id={ids.error} role="alert" className="text-small font-semibold text-failed">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabledReason={pending ? "Adding and testing…" : !name.trim() || !url.trim() ? "Give it a name and a URL first." : undefined}>
              {pending ? "Adding and testing…" : "Add and test"}
            </Button>
            <Button variant="quiet" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {servers.length > 0 ? (
        <ul aria-label="MCP servers" className="flex flex-col gap-2">
          {servers.map((s) => (
            <ServerRow key={s.id} s={s} canAct={canAct} />
          ))}
        </ul>
      ) : (
        !open && <p className="text-small text-ink-2">No MCP servers yet.</p>
      )}
    </section>
  );
}
