import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { AGENT_RULES, MCP_TOOLS, SCOPES } from "@/lib/mcp";
import { PERMISSIONS } from "@/lib/policies";
import { origin } from "@/server/origin";

export const metadata: Metadata = { title: "MCP server · Architect", description: "The tools a coding agent can use on an Architect project, with a project token." };

function Snippet({ title, code }: { title: string; code: string }) {
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="text-small font-semibold text-ink-2">{title}</figcaption>
      <pre className="overflow-auto rounded-card border border-line bg-tray p-4 font-mono text-[12.5px] leading-[1.7]">{code}</pre>
    </figure>
  );
}

/** /docs/mcp (B-7): the MCP tool spec for bringing your own coding agent (F4). The server itself is simulated. */
export default async function McpDocsPage() {
  const site = await origin();
  const url = `${site}/api/mcp`;
  return (
    <div className="min-h-dvh bg-canvas p-2.5">
      <header className="flex min-h-[66px] items-center gap-3 px-1 py-2">
        <Link href="/home" aria-label="Back to Architect" className="grid size-[38px] place-items-center rounded-full hover:bg-selected">
          <Icon name="chevronLeft" size="sm" />
        </Link>
        <span className="text-sub font-semibold">Architect docs</span>
      </header>
      <main className="rounded-pane border border-line bg-surface shadow-pane">
        <article className="mx-auto flex w-full max-w-[820px] flex-col gap-8 px-8 pt-10 pb-14 max-sm:px-4">
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-2 text-small font-semibold text-ink-2">
              Bring your own coding agent <SimTag title="The MCP server is a spec in this prototype: no server accepts tokens yet." />
            </span>
            <h1 className="text-title font-[650]">Architect&apos;s MCP server</h1>
            <p className="text-sub text-ink-2">
              Claude Code, Cursor or any coding agent that speaks MCP can work on an Architect project with a project token. It uses the same tools as Architect&apos;s own
              agent, on its own branch, and the same rules hold: every change waits for its check, and only the checker can mark a part Works.
            </p>
            <p className="rounded-card bg-tray px-3.5 py-2.5 text-ink-2">
              <b className="text-ink">Simulated in this prototype.</b> This page is the spec: project tokens are real records, but no MCP server accepts them yet, and the
              coding-agent sessions you see in a project are scripted. The other direction is real: in Connections › MCP servers, Test connection calls your MCP server and
              lists its tools.
            </p>
          </div>

          <section aria-labelledby="connect" className="flex flex-col gap-3">
            <h2 id="connect" className="text-heading font-[650]">
              Connect
            </h2>
            <ol className="flex list-decimal flex-col gap-1 pl-5">
              <li>In the project, open ⋯ › Project settings › Coding agents and make a token. Pick only what the agent needs.</li>
              <li>With governance on, an Owner or Admin approves the token before it works.</li>
              <li>Add the server to your agent with the token, as below. Revoke the token any time in the same place.</li>
            </ol>
            <Snippet title="Claude Code" code={`claude mcp add --transport http architect ${url} \\\n  --header "Authorization: Bearer ax_pt_…"`} />
            <Snippet
              title="Cursor (.cursor/mcp.json)"
              code={JSON.stringify({ mcpServers: { architect: { url, headers: { Authorization: "Bearer ax_pt_…" } } } }, null, 2)}
            />
          </section>

          <section aria-labelledby="rules" className="flex flex-col gap-3">
            <h2 id="rules" className="text-heading font-[650]">
              Rules every tool follows
            </h2>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>A token belongs to one project and only has the scopes it was made with: {SCOPES.map((s) => s.label.toLowerCase()).join("; ")}.</li>
              <li>A coding agent can&apos;t mark a part Works. Any change sends the part back to wait for its check; the checker re-runs the part&apos;s locked check.</li>
              <li>Nothing goes to main directly. Work lands on a branch and comes back as a pull request; merging is a person&apos;s click.</li>
              <li>Policies apply as for Architect&apos;s own agent: allowed models and connectors, egress and the organisation&apos;s budget.</li>
              <li>
                Every permission rule applies, and an agent is never an Owner or Admin, so each of these is a request through <code className="font-mono">request_approval</code>, never something it does itself:
                <ul className="mt-1 flex list-[circle] flex-col gap-0.5 pl-5">
                  {AGENT_RULES.map((r) => (
                    <li key={r.rule}>
                      {PERMISSIONS.find((p) => p.id === r.rule)?.label}: {r.refusal.replace(/; use request_approval$/, "")}.
                    </li>
                  ))}
                </ul>
              </li>
              <li>Everything the agent does shows in Activity as &ldquo;Coding agent: &lt;agent&gt; (&lt;person&gt;) · via MCP&rdquo;, and in the audit log.</li>
            </ul>
          </section>

          <section aria-labelledby="tools" className="flex flex-col gap-3">
            <h2 id="tools" className="text-heading font-[650]">
              Tools
            </h2>
            <ul className="flex flex-col gap-3">
              {MCP_TOOLS.map((t) => (
                <li key={t.name} id={t.name} className="flex flex-col gap-2 rounded-card border border-line p-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <code className="font-mono text-body font-semibold">{t.name}</code>
                    <span className="text-small text-ink-2">scope: {SCOPES.find((s) => s.id === t.scope)?.label}</span>
                  </div>
                  <p>{t.does}</p>
                  <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-small">
                    <dt className="font-semibold text-ink-2">Input</dt>
                    <dd>
                      <code className="font-mono break-words">{t.input}</code>
                    </dd>
                    <dt className="font-semibold text-ink-2">Output</dt>
                    <dd>
                      <code className="font-mono break-words">{t.output}</code>
                    </dd>
                    <dt className="font-semibold text-ink-2">Policy</dt>
                    <dd>{t.policy}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        </article>
      </main>
    </div>
  );
}
