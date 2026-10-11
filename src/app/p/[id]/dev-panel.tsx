"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { SimTag } from "@/components/ax/pill";
import { Segmented } from "@/components/ax/segmented";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ax/icon";
import {
  buildLogs,
  consoleCounts,
  consoleEntries,
  fixRequest,
  LIVE_ENV_LABEL,
  liveLogs,
  promptLine,
  WELCOME,
  type ConsoleEntry,
  type ConsoleLevel,
  type LiveEnv,
  type PanelPart,
} from "@/lib/dev-panel";
import { branchInfo, slugOf, type TerminalLine } from "@/lib/dev-view";
import type { LiveRun } from "@/lib/sim/replay";
import { canBuild } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { sendMessage } from "@/server/actions/chat";
import { deployedEnvs, endTerminalSession, listTerminalSessions, loadTerminalSession, runCommand, saveTerminalSession, type TerminalSessionSummary } from "@/server/actions/terminal";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";

type Tab = "terminal" | "console" | "build" | "live";

const parts = (items: WorkspaceItem[]): PanelPart[] => items.map((i) => ({ key: i.key, title: i.title, status: i.status, statusDetail: i.statusDetail, provider: i.provider, grp: i.grp }));

/** Events the run has played so far (a running build replays on the clock). */
function played(project: ProjectWorkspace, live: LiveRun) {
  const run = project.run;
  if (!run) return [];
  if (run.status !== "running") return run.events;
  const ids = new Set(live.activity.map((a) => a.id));
  const last = Math.max(-1, ...run.events.filter((e) => ids.has(e.id)).map((e) => e.atMs));
  return run.events.filter((e) => e.atMs <= Math.max(last, 0));
}

function Lines({ lines, prompt }: { lines: TerminalLine[]; prompt: string }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className={cn("whitespace-pre-wrap", l.kind === "ok" && "text-works", l.kind === "fail" && "text-failed", l.kind === "info" && "text-ink-2")}>
          {l.kind === "cmd" ? (
            <>
              <span className="text-ink-2">{prompt}</span> {l.text}
            </>
          ) : (
            l.text
          )}
        </div>
      ))}
    </>
  );
}

const stamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Terminal: a prompt and one welcome line, then your commands (mapped to the project's data; nothing runs in a shell).
 * Each session is saved per project; earlier ones open read-only from Sessions. Clear ends the session.
 */
function TerminalTab({ project, prompt }: { project: ProjectWorkspace; prompt: string }) {
  const router = useRouter();
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [viewing, setViewing] = useState<{ id: string; label: string; lines: TerminalLine[] } | null>(null);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [running, setRunning] = useState(0);
  const [note, setNote] = useState<string>();
  const inputId = useId();
  const log = useRef<HTMLDivElement>(null);
  const refreshSessions = () => void listTerminalSessions({ projectId: project.id }).then((r) => r.ok && setSessions(r.sessions));
  useEffect(refreshSessions, [project.id]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [lines.length, viewing]);

  const shown = viewing ? viewing.lines : lines;
  const text = () => [WELCOME, ...shown.map((l) => (l.kind === "cmd" ? `${prompt} ${l.text}` : l.text))].join("\n");

  const run = async (line: string) => {
    setRunning((n) => n + 1);
    setCommand("");
    setHistory((h) => [line, ...h].slice(0, 20));
    const before = [...lines, { kind: "cmd" as const, text: line }];
    setLines(before);
    try {
      const r = await runCommand({ projectId: project.id, command: line });
      const next = !r.ok ? [...before, { kind: "fail" as const, text: r.message }] : r.clear ? [] : [...before, ...r.lines];
      setLines(next);
      if (r.ok && r.clear) return clear();
      const saved = await saveTerminalSession({ projectId: project.id, sessionId, lines: next });
      if (saved.ok && saved.sessionId !== sessionId) {
        setSessionId(saved.sessionId);
        refreshSessions();
      }
      // A re-run of the checks writes proofs: let the rest of the page catch up.
      if (/^(npm (run )?test|pytest)$/.test(line)) router.refresh();
    } catch {
      setLines((m) => [...m, { kind: "fail", text: "The command didn't reach Architect. Try again." }]);
    } finally {
      setRunning((n) => n - 1);
    }
  };
  const clear = () => {
    if (sessionId) void endTerminalSession({ sessionId }).then(refreshSessions);
    setSessionId(null);
    setLines([]);
    setViewing(null);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setNote("Copied");
    } catch {
      setNote("Couldn't copy: select the text instead");
    }
    window.setTimeout(() => setNote(undefined), 2000);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text() + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugOf(project.name)}-terminal.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const open = (s: TerminalSessionSummary) =>
    void loadTerminalSession({ sessionId: s.id }).then((r) => r.ok && setViewing({ id: s.id, label: `${stamp(s.startedAt)} · ${s.by}`, lines: r.lines }));
  const earlier = sessions.filter((s) => s.id !== sessionId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-transparent bg-(--btn) px-3 text-small font-[550] text-ink hover:bg-(--btn-hover)">
            {viewing ? viewing.label : "Current session"}
            <Icon name="chevronDown" size="sm" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-64 rounded-card p-1.5">
            <DropdownMenuItem className="flex min-h-9 flex-col items-start gap-0 rounded-tile px-2.5 py-1" onSelect={() => setViewing(null)}>
              <span className="font-semibold">Current session</span>
              <span className="text-small text-ink-2">{lines.filter((l) => l.kind === "cmd").length} commands</span>
            </DropdownMenuItem>
            {earlier.map((s) => (
              <DropdownMenuItem key={s.id} className="flex min-h-9 flex-col items-start gap-0 rounded-tile px-2.5 py-1" onSelect={() => open(s)}>
                <span className="font-semibold">{stamp(s.startedAt)}</span>
                <span className="text-small text-ink-2">
                  {s.by} · {s.commands} {s.commands === 1 ? "command" : "commands"} · read-only
                </span>
              </DropdownMenuItem>
            ))}
            {!earlier.length && <p className="px-2.5 py-1.5 text-small text-ink-2">No earlier sessions yet.</p>}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="flex-1" />
        {note && (
          <span role="status" className="text-small text-ink-2">
            {note}
          </span>
        )}
        <Button size="sm" variant="quiet" disabledReason={viewing ? "An earlier session is read-only." : !lines.length ? "Nothing to clear." : undefined} onClick={clear}>
          Clear
        </Button>
        <Button size="sm" variant="quiet" icon="copy" onClick={() => void copy()}>
          Copy
        </Button>
        <Button size="sm" variant="quiet" icon="download" onClick={download}>
          Download
        </Button>
      </div>
      <div ref={log} role="log" aria-label={viewing ? `Terminal session, ${viewing.label}, read-only` : "Terminal"} className="min-h-0 flex-1 overflow-auto px-4 py-3 leading-[1.7]">
        <div className="text-ink-2">{WELCOME}</div>
        <Lines lines={shown} prompt={prompt} />
        {viewing && <div className="pt-2 text-ink-2">Earlier session · read-only</div>}
      </div>
      {!viewing && (
        <form
          className="flex items-center gap-2 border-t border-line px-4 py-2 focus-within:shadow-[inset_0_2px_0_var(--focus)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (command.trim()) void run(command.trim());
          }}
        >
          <label htmlFor={inputId} className="flex-none text-ink-2">
            {prompt}
            <span className="sr-only"> Command</span>
          </label>
          <input
            id={inputId}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && history.length) {
                e.preventDefault();
                setCommand(history[0]);
              }
            }}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            placeholder={running ? "Running…" : ""}
            className="min-h-8 min-w-0 flex-1 bg-transparent text-ink outline-none!"
          />
        </form>
      )}
    </div>
  );
}

const LEVEL_WORD: Record<ConsoleLevel, string> = { error: "Error", warn: "Warning", log: "Log" };

/** Console: the preview's errors, warnings and logs, filtered by level; each error can become a change card. */
function ConsoleTab({ project, entries }: { project: ProjectWorkspace; entries: ConsoleEntry[] }) {
  const router = useRouter();
  const [level, setLevel] = useState<ConsoleLevel | "all">("all");
  const [sent, setSent] = useState<Record<string, "sending" | "sent" | string>>({});
  const [, start] = useTransition();
  const counts = consoleCounts(entries);
  const shown = level === "all" ? entries : entries.filter((e) => e.level === level);
  const fix = (e: ConsoleEntry) =>
    start(async () => {
      setSent((s) => ({ ...s, [e.id]: "sending" }));
      const r = await sendMessage({ projectId: project.id, content: fixRequest(e) });
      setSent((s) => ({ ...s, [e.id]: r.ok ? "sent" : r.message }));
      router.refresh();
    });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <Segmented
          label="Show"
          mode="filter"
          value={level}
          onChange={setLevel}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "error", label: "Errors", count: counts.error },
            { value: "warn", label: "Warnings", count: counts.warn },
            { value: "log", label: "Logs", count: counts.log },
          ]}
        />
      </div>
      <ol aria-label="Console" className="min-h-0 flex-1 overflow-auto">
        {shown.map((e) => (
          <li key={e.id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-1 border-t border-line px-4 py-2", e.level === "error" && "bg-failed-bg")}>
            <span className={cn("w-16 flex-none font-semibold", e.level === "error" ? "text-failed" : e.level === "warn" ? "text-attention" : "text-ink-2")}>{LEVEL_WORD[e.level]}</span>
            <span className="min-w-0 flex-1">
              <span className="block whitespace-pre-wrap text-ink">{e.text}</span>
              <span className="block text-ink-2">{e.source}</span>
            </span>
            {e.level === "error" &&
              (sent[e.id] === "sent" ? (
                <span role="status" className="text-small text-ink-2">
                  Change card in chat
                </span>
              ) : (
                <Button size="sm" icon="sparkle" disabledReason={sent[e.id] === "sending" ? "Sending…" : !canBuild(project.role) ? "Viewers can't change the plan." : undefined} onClick={() => fix(e)}>
                  Fix with AI
                </Button>
              ))}
            {sent[e.id] && sent[e.id] !== "sent" && sent[e.id] !== "sending" && (
              <p role="alert" className="w-full text-small text-failed">
                {sent[e.id]}
              </p>
            )}
          </li>
        ))}
        {!shown.length && <li className="px-4 py-3 text-ink-2">{entries.length ? "Nothing at this level." : "The preview hasn't logged anything yet. It does once parts are built."}</li>}
      </ol>
    </div>
  );
}

/** Build logs: per part, from the simulator, collapsible. */
function BuildTab({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live: LiveRun }) {
  const titles = Object.fromEntries(items.map((i) => [i.key, i.title]));
  const logs = buildLogs({ events: played(project, live), titles, parts: parts(items) });
  if (!logs.length) {
    const built = items.some((i) => i.status === "built" || i.status === "sample_data");
    return (
      <p className="px-4 py-3 text-ink-2">
        {project.run?.startedAt ? "No logs were recorded for this build." : built ? "No build logs for this version: it was built before logs were kept here. The next build's appear here." : "No build yet. Each part's log appears here when you click Build."}
      </p>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {logs.map((l) => (
        <details key={l.key} className="group border-t border-line" open={l.status === "failed" || l.status === "paused" || l.status === "building"}>
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 px-4 hover:bg-selected">
            <Icon name="chevronDown" size="sm" className="-rotate-90 transition-transform group-open:rotate-0" />
            <span className="flex-1 font-semibold">{l.title}</span>
            <span className="text-ink-2">{l.lines.length} lines</span>
          </summary>
          <div className="px-10 pb-2.5">
            <Lines lines={l.lines} prompt="$" />
          </div>
        </details>
      ))}
    </div>
  );
}

/** Live logs: runtime logs for the Test version, the Team version or Live. */
function LiveTab({ project, items }: { project: ProjectWorkspace; items: WorkspaceItem[] }) {
  const [env, setEnv] = useState<LiveEnv>("test");
  const [deployed, setDeployed] = useState<Record<LiveEnv, boolean> | null>(null);
  const [now] = useState(() => new Date());
  useEffect(() => {
    void deployedEnvs({ projectId: project.id }).then(setDeployed);
  }, [project.id]);
  const lines = deployed ? liveLogs({ projectId: project.id, env, deployed: deployed[env], parts: parts(items), now }) : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <Segmented label="Environment" mode="filter" value={env} onChange={setEnv} options={(["test", "team", "live"] as const).map((e) => ({ value: e, label: LIVE_ENV_LABEL[e] }))} />
      </div>
      <ol aria-label={`Live logs, ${LIVE_ENV_LABEL[env]}`} className="min-h-0 flex-1 overflow-auto px-4 py-1 leading-[1.7]">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-3 whitespace-pre-wrap">
            <span className="flex-none text-ink-2">{new Date(l.at).toLocaleTimeString("en-GB")}</span>
            <span className={cn(l.level === "warn" && "text-attention", l.level === "error" && "text-failed")}>{l.text}</span>
          </li>
        ))}
        {deployed && !lines.length && (
          <li className="text-ink-2">
            {deployed[env]
              ? "No requests yet."
              : env === "test"
                ? "No test version yet. It runs once you click Build."
                : `Nothing is deployed to ${env === "team" ? "the Team version" : "Live"} yet. Launch it from the Launch page.`}
          </li>
        )}
        {!deployed && <li className="text-ink-2">Loading…</li>}
      </ol>
    </div>
  );
}

/**
 * The Developer panel (M5.10, replaces the terminal): Terminal, Console, Build logs and Live logs. One Simulated label;
 * Geist Mono on the dark surface in both themes (the panel always uses the dark tokens). Builders and up.
 */
export function DevPanel({ project, items, live }: { project: ProjectWorkspace; items: WorkspaceItem[]; live: LiveRun }) {
  const [tab, setTab] = useState<Tab>("terminal");
  const branch = branchInfo({
    projectId: project.id,
    name: project.name,
    version: project.plan?.version ?? 1,
    repo: project.repo,
    runStatus: project.run?.status ?? null,
    parts: items.map((i) => ({ key: i.key, title: i.title, description: i.description, provedWhen: i.provedWhen, grp: i.grp, status: i.status, provider: i.provider, position: i.position })),
    // The branch the terminal is on, the same one `git status` reports.
  }).branch;
  const prompt = promptLine(project.name, branch);
  const entries = useMemo(() => consoleEntries(parts(items)), [items]);
  const errors = entries.filter((e) => e.level === "error").length;
  return (
    <div data-theme="dark" className="m-3 mt-0 flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-surface pt-2.5 font-mono text-[12.5px] text-ink">
      <div className="flex items-center gap-2 px-3 pb-2.5 font-sans">
        {/* On a phone the tabs scroll sideways rather than wrapping. */}
        <div className="min-w-0 overflow-x-auto">
          <Segmented
          label="Developer panel"
          value={tab}
          onChange={setTab}
          options={[
            { value: "terminal", label: "Terminal" },
            { value: "console", label: "Console", count: errors || undefined },
            { value: "build", label: "Build logs" },
            { value: "live", label: "Live logs" },
          ]}
          />
        </div>
        <span className="flex-1" />
        <SimTag title="The terminal reads this project's files and re-runs its checks; the console, build logs and live logs come from the simulated build and deploys." />
      </div>
      {tab === "terminal" && <TerminalTab project={project} prompt={prompt} />}
      {tab === "console" && <ConsoleTab project={project} entries={entries} />}
      {tab === "build" && <BuildTab project={project} items={items} live={live} />}
      {tab === "live" && <LiveTab project={project} items={items} />}
    </div>
  );
}
