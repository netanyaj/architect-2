"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ax/button";
import { EmptyState } from "@/components/ax/empty-state";
import { Icon } from "@/components/ax/icon";
import { SimTag, Tag } from "@/components/ax/pill";
import { Select } from "@/components/ax/select";
import { StatusMark } from "@/components/ax/status-mark";
import { Stepper } from "@/components/ax/stepper";
import { providerName } from "@/lib/providers";
import { relativeTime } from "@/lib/project-status";
import { cn } from "@/lib/utils";
import { analyzeImport, importRepoDetails, importRepos, planFromImport, type ImportView } from "@/server/actions/import";
import type { RepoSummary } from "@/server/github";
import type { ImportPageData } from "@/server/import";

type Step = "choose" | "understand" | "plan";
const STEPS: { id: Step; label: string }[] = [
  { id: "choose", label: "Choose repo" },
  { id: "understand", label: "Understand it" },
  { id: "plan", label: "Plan from repo" },
];
const FRAMEWORK: Record<string, string> = { crewai: "CrewAI", langgraph: "LangGraph", lyzr: "Lyzr" };
const STACK_NOTE = "New projects use Next.js + Python (Lyzr SDK) + Postgres + sign-in. Imported projects keep their stack.";

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-1.5 rounded-card border border-line bg-surface p-4", className)}>
      <h3 className="text-small font-semibold text-ink-2">{title}</h3>
      {children}
    </section>
  );
}

function Problem({ text, action }: { text: string; action?: React.ReactNode }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card border-[1.5px] border-failed bg-surface px-4 py-3">
      <span className="flex-1 font-semibold text-failed">{text}</span>
      {action}
    </div>
  );
}

/** Understand it (screen 10): stack, how it starts, agents, keys, and the tests that become the checks. */
function Understanding({ view, runChoice, setRunChoice }: { view: ImportView; runChoice: RunChoice; setRunChoice: (c: RunChoice) => void }) {
  const a = view.analysis;
  const proved = view.behaviour.filter((b) => b.tests.length);
  const testsUsed = proved.reduce((n, b) => n + b.tests.length, 0);
  const failing = new Set(a.tests.filter((t) => t.knownFailing).map((t) => t.name));
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-8 py-9 max-sm:px-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-small font-semibold text-ink-2">
          {view.repo} · {view.branch}
          {view.folder !== "/" ? ` · ${view.folder}` : ""}
        </span>
        <h2 className="text-title font-[650]">{a.runnable.ok ? "Architect can run this as it is" : "Architect can't run this as it is yet"}</h2>
        <p className="text-sub text-ink-2">
          {a.runnable.ok
            ? `Your ${a.languages.join(" and ")} code stays the same. New work happens on a branch and comes back to you as a pull request.`
            : a.runnable.reason}
        </p>
      </div>

      {!a.runnable.ok && (
        <section aria-label="How to go on" className="flex flex-col gap-3 rounded-card border-[1.5px] border-ink bg-surface p-4">
          <p className="font-semibold">Choose how Architect should run it. Nothing in your repo changes until you agree to a plan and click Build.</p>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="run" className="mt-1" checked={runChoice.kind === "configure"} onChange={() => setRunChoice({ kind: "configure", command: runChoice.kind === "configure" ? runChoice.command : "" })} />
            <span className="flex flex-1 flex-col gap-1.5">
              <span className="font-[550]">Configure: tell Architect how it starts</span>
              {runChoice.kind === "configure" && (
                <input
                  aria-label="Start command"
                  value={runChoice.command}
                  onChange={(e) => setRunChoice({ kind: "configure", command: e.target.value })}
                  placeholder="e.g. bundle exec rails server"
                  maxLength={200}
                  className="min-h-9 rounded-tile border border-line-ctl bg-surface px-3 font-mono text-small"
                />
              )}
            </span>
          </label>
          <label className="flex items-start gap-2.5">
            <input type="radio" name="run" className="mt-1" checked={runChoice.kind === "port"} onChange={() => setRunChoice({ kind: "port" })} />
            <span className="flex flex-col">
              <span className="font-[550]">Port it to Next.js + Python (Lyzr SDK) + Postgres + sign-in</span>
              <span className="text-small text-ink-2">The plan describes the move part by part, with its cost. Nothing is ported until you click Build.</span>
            </span>
          </label>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <Card title="How it's built">
          <strong className="font-[650]">{a.stack}</strong>
          {a.evidence.length > 0 && <span className="text-small text-ink-2">Found in {a.evidence.join(", ")}</span>}
        </Card>
        <Card title="How it starts">
          {a.run.length || a.install.length ? (
            <>
              {[...a.install, ...a.run].map((c) => (
                <code key={c} className="font-mono text-small">
                  {c}
                </code>
              ))}
              {a.testCommand && <code className="font-mono text-small text-ink-2">{a.testCommand}</code>}
            </>
          ) : (
            <span className="text-ink-2">No start command found. Configure it after import.</span>
          )}
          <span className="mt-1 flex items-center gap-2 text-small text-ink-2">
            {a.runnable.ok ? "Runs as it is in the test version" : "Not run until you choose"} <SimTag />
          </span>
        </Card>
        <Card title="AI agents">
          {a.agents.length ? (
            <>
              <ul className="flex flex-col gap-1">
                {a.agents.map((g) => (
                  <li key={`${g.file}-${g.name}`} className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-small font-semibold">{g.name}</code>
                    <Tag>{FRAMEWORK[g.framework]}</Tag>
                    {g.role && <span className="text-small text-ink-2">{g.role}</span>}
                  </li>
                ))}
              </ul>
              <span className="text-small text-ink-2">
                {a.agents.some((g) => g.framework !== "lyzr")
                  ? "Keeps running in its own framework, with its runs shown in Agents. Moving it to Lyzr is optional."
                  : "Runs on Lyzr Studio, shown in Agents."}
              </span>
            </>
          ) : (
            <span className="text-ink-2">No agent code found (Lyzr, CrewAI or LangGraph).</span>
          )}
        </Card>
        <Card title="Keys it needs">
          {a.keys.length ? (
            <ul className="flex flex-col gap-1.5">
              {a.keys.map((k) => (
                <li key={k.name} className="flex flex-wrap items-center gap-2">
                  <code className="flex-1 font-mono text-small">{k.name}</code>
                  <span className="text-small text-ink-2">
                    {k.lyzrInstead ? "Lyzr can provide the model instead" : k.service ? `Connect ${providerName(k.service)} after import` : "Add it in Keys and passwords"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-2">None found in .env.example.</span>
          )}
        </Card>
      </div>

      <section aria-label="Your tests become the checks" className="flex flex-col gap-2">
        <h3 className="text-sub font-[650]">Your tests become the checks</h3>
        {view.behaviourError ? (
          <Problem text={view.behaviourError} />
        ) : (
          <p className="text-ink-2">
            {a.tests.length === 0
              ? "No tests found. Architect writes a check for every part."
              : `${testsUsed} of your ${a.tests.length} tests prove ${proved.length} of the ${view.behaviour.length} parts it does today.${proved.length < view.behaviour.length ? " Architect writes a check for the rest." : ""}`}
          </p>
        )}
        {view.behaviour.length > 0 && (
          <table className="w-full overflow-hidden rounded-card border border-line text-left">
            <thead className="bg-tray text-small text-ink-2">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Part of the plan</th>
                <th className="px-4 py-2.5 font-semibold">Proved by</th>
              </tr>
            </thead>
            <tbody>
              {view.behaviour.map((b) => {
                const fails = b.tests.filter((t) => failing.has(t));
                return (
                  <tr key={b.title} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <span className="block">{b.title}</span>
                      <span className="block text-small text-ink-2">{b.description}</span>
                    </td>
                    <td className="px-4 py-3">
                      {b.tests.length ? (
                        <span className="flex flex-col">
                          <span>
                            {b.tests.length} of your tests{fails.length ? ` · ${fails.length} marked failing` : ""}
                          </span>
                          <span className="text-small text-ink-2">{b.tests.map((t) => `"${t}"`).join(", ")}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2 font-semibold">
                          <StatusMark status="todo" />
                          Architect writes a check
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="text-small text-ink-2">
          Architect read {a.read.files} files ({Math.round(a.read.bytes / 1024)} KB) and changed nothing.{a.read.skippedLarge ? ` ${a.read.skippedLarge} files over 64 KB weren't read.` : ""}
          {a.read.truncated ? " The repo is very large, so only part of its file list was read." : ""} Running your tests is simulated in this prototype.
        </p>
      </section>
    </div>
  );
}

type RunChoice = { kind: "none" } | { kind: "configure"; command: string } | { kind: "port" };

/** Moving an Architect 1.0 app to 2.0 (F9): its repo is chosen for you, and the new plan records the move. */
export type MoveFrom = { projectId: string; name: string; repo: string };

export function ImportFlow({ data, notice, move }: { data: ImportPageData; notice: { kind: "error" | "done"; text: string } | null; move?: MoveFrom | null }) {
  const router = useRouter();
  const [installationId, setInstallationId] = useState<number | null>(data.installations[0]?.installationId ?? null);
  const install = data.installations.find((i) => i.installationId === installationId) ?? null;
  const [repos, setRepos] = useState<RepoSummary[] | null>(null);
  const [repo, setRepo] = useState<string | null>(null);
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState<string>("");
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState("/");
  const [view, setView] = useState<ImportView | null>(null);
  const [step, setStep] = useState<Step>("choose");
  const [runChoice, setRunChoice] = useState<RunChoice>({ kind: "none" });
  const [error, setError] = useState<string | null>(null);
  const [loadingRepos, startRepos] = useTransition();
  const [loadingRepo, startRepo] = useTransition();
  const [analyzing, startAnalyze] = useTransition();
  const [planning, startPlan] = useTransition();


  const chooseRepo = (name: string, nextBranch?: string) => {
    if (!installationId) return;
    setRepo(name);
    setView(null);
    setStep("choose");
    setRunChoice({ kind: "none" });
    startRepo(async () => {
      setError(null);
      const r = await importRepoDetails({ installationId, repo: name, branch: nextBranch });
      if (!r.ok) {
        setBranches([]);
        setFolders([]);
        return setError(r.message);
      }
      setBranches(r.branches);
      setBranch(r.branch);
      setFolders(r.folders);
      setFolder("/");
    });
  };

  useEffect(() => {
    if (!installationId) return;
    startRepos(async () => {
      setError(null);
      setRepos(null);
      const r = await importRepos({ installationId });
      if (r.ok) {
        setRepos(r.repos);
        if (move && r.repos.some((x) => x.fullName === move.repo)) chooseRepo(move.repo);
      } else setError(r.message);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the installation changes
  }, [installationId]);

  // F9: the 1.0 app's repo is chosen as the repos arrive (above); if the App can't read it, say so.
  const moveNote = move && repos && !repos.some((r) => r.fullName === move.repo) ? `Architect can't read ${move.repo} yet. Install the GitHub App on it, then come back with Move to 2.0.` : null;

  const understand = () =>
    startAnalyze(async () => {
      if (!installationId || !repo) return;
      setError(null);
      const r = await analyzeImport({ installationId, repo, branch, folder });
      if (!r.ok) return setError(r.message);
      setView(r.view);
      setStep("understand");
    });

  const writePlan = () =>
    startPlan(async () => {
      if (!view) return;
      setError(null);
      setStep("plan");
      const r = await planFromImport({ importId: view.importId, port: runChoice.kind === "port", runCommand: runChoice.kind === "configure" ? runChoice.command : undefined, fromProjectId: move?.projectId });
      if (!r.ok) {
        setStep("understand");
        return setError(r.message);
      }
      router.push(`/p/${r.projectId}`);
    });

  // The header's one primary: Understand it on step 1, Write the plan on step 2.
  const needsChoice = view && !view.analysis.runnable.ok && (runChoice.kind === "none" || (runChoice.kind === "configure" && !runChoice.command.trim()));
  const action =
    step === "choose"
      ? {
          label: analyzing ? "Reading the repo…" : "Understand it",
          reason: !data.canAct ? "Viewers can't import repos." : !repo ? "Choose a repo first." : loadingRepo ? "Loading the repo…" : analyzing ? "Reading the repo…" : !branch ? "Choose a branch first." : undefined,
          onClick: understand,
        }
      : {
          label: planning ? "Starting the plan…" : "Write the plan",
          reason: !data.canAct ? "Viewers can't import repos." : planning ? "Starting the plan…" : needsChoice ? "Choose Configure or Port first." : undefined,
          onClick: writePlan,
        };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-2.5 pb-[64px]">
      <header className="flex min-h-[66px] flex-wrap items-center gap-3 px-1 py-2">
        <Link href="/projects" aria-label="Back to projects" className="grid size-[38px] place-items-center rounded-full hover:bg-selected">
          <Icon name="chevronLeft" size="sm" />
        </Link>
        <h1 className="text-sub font-semibold">Import a repo</h1>
        <Stepper<Step>
          steps={STEPS}
          current={step}
          label="Import steps"
          onSelect={(s) => {
            if (s === "choose") setStep("choose");
            else if (s === "understand" && view) setStep("understand");
          }}
        />
        <div className="flex items-center gap-2">
          <Button variant="quiet" href="/projects">
            Cancel
          </Button>
          {data.installations.length > 0 && (
            <Button variant="primary" iconAfter="chevronRight" disabledReason={action.reason} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-2.5 max-lg:flex-col">
        <aside aria-label="GitHub" className="flex w-[340px] flex-none flex-col gap-3 rounded-pane border border-line bg-tray p-4 shadow-pane max-lg:w-full">
          <div className="flex items-center gap-2">
            <h2 className="flex-1 text-heading font-[650]">GitHub{install ? ` · ${install.accountLogin}` : ""}</h2>
            {install && (
              <a href={install.manageUrl} target="_blank" rel="noreferrer" className="text-body font-semibold underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink">
                Manage access
              </a>
            )}
          </div>
          <p className="text-small text-ink-2">Architect can read only the repos you chose. It never gets access to your whole account, and never writes to your repo without a pull request.</p>
          {data.installations.length > 1 && (
            <label className="flex flex-col gap-1 text-small font-semibold text-ink-2">
              Account
              <Select value={String(installationId ?? "")} onChange={(e) => setInstallationId(Number(e.target.value))} wrapperClassName="w-full">
                {data.installations.map((i) => (
                  <option key={i.installationId} value={i.installationId}>
                    {i.accountLogin}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {data.installations.length > 0 && (
            <>
              <ul aria-label="Repos" className="flex flex-col gap-1 rounded-card border border-line bg-surface p-1.5">
                {loadingRepos && <li className="p-2 text-small text-ink-2" role="status">Loading your repos…</li>}
                {repos?.map((r) => {
                  const project = data.imported[r.fullName];
                  const on = r.fullName === repo;
                  return (
                    <li key={r.fullName}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => chooseRepo(r.fullName)}
                        className={cn("flex w-full items-start gap-2.5 rounded-tile p-2 text-left hover:bg-selected", on && "bg-selected")}
                      >
                        <span className={cn("grid size-7 flex-none place-items-center rounded-tile border border-line", on && "border-primary bg-primary text-on-primary")} aria-hidden="true">
                          <Icon name="repo" size="sm" />
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{r.fullName}</span>
                          <span className="text-small text-ink-2">
                            {project ? "Already a project" : [r.language, r.private ? "private" : null, r.pushedAt ? `updated ${relativeTime(r.pushedAt)}` : null].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                      {project && (
                        <Link href={`/p/${project}`} className="ml-[46px] text-small font-semibold underline decoration-line-ctl underline-offset-[3px]">
                          Open {r.fullName.split("/")[1]}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
              {data.installUrl && (
                <a href={data.installUrl} className="self-start text-body font-semibold underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink">
                  Install on more repos
                </a>
              )}
              {repo && (
                <>
                  <label className="flex flex-col gap-1 text-small font-semibold text-ink-2">
                    Branch
                    <Select value={branch} onChange={(e) => chooseRepo(repo, e.target.value)} aria-disabled={loadingRepo || undefined} wrapperClassName="w-full" controlSize="md">
                      {branches.map((b) => (
                        <option key={b}>{b}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1 text-small font-semibold text-ink-2">
                    Folder
                    <Select value={folder} onChange={(e) => setFolder(e.target.value)} wrapperClassName="w-full" controlSize="md">
                      <option value="/">Whole repo</option>
                      {folders.map((f) => (
                        <option key={f} value={`/${f}`}>
                          {f}/
                        </option>
                      ))}
                    </Select>
                  </label>
                </>
              )}
            </>
          )}
        </aside>

        <main className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-auto rounded-pane border border-line bg-surface shadow-pane">
          {move && (
            <div className="px-8 pt-6 max-sm:px-4">
              <p role="status" className="rounded-card border border-line px-4 py-3">
                <b className="font-semibold">Moving {move.name} to 2.0.</b> Its repo, <code className="font-mono text-small">{move.repo}</code>, is chosen. The 1.0 app keeps running while you do this.
                {moveNote ? ` ${moveNote}` : ""}
              </p>
            </div>
          )}
          {(notice || error) && (
            <div className="px-8 pt-6 max-sm:px-4">
              {error ? (
                <Problem text={error} action={data.installUrl && /install|Manage access|taken off/i.test(error) ? <a className={buttonClasses({ size: "sm" })} href={data.installUrl}>Install on more repos</a> : undefined} />
              ) : notice?.kind === "error" ? (
                <Problem text={notice.text} />
              ) : (
                <p role="status" className="rounded-card border border-line px-4 py-3 font-semibold">
                  {notice!.text}
                </p>
              )}
            </div>
          )}
          {data.installations.length === 0 ? (
            <EmptyState
              icon="repo"
              title="Connect GitHub first"
              primary={
                data.installUrl ? (
                  <a className={buttonClasses({ variant: "primary" })} href={data.installUrl}>
                    Install the GitHub App
                  </a>
                ) : (
                  <Button variant="primary" disabledReason="The GitHub App isn't set up on this server.">
                    Install the GitHub App
                  </Button>
                )
              }
              alternative={
                // A plain link: the sign-in starts on click, never on a prefetch.
                <a href="/api/github/connect" className="text-body font-semibold underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink">
                  Already installed? Connect it
                </a>
              }
            >
              Install Architect&apos;s GitHub App on the repos you want to import. It can only read them: their files, branches and settings. {STACK_NOTE}
            </EmptyState>
          ) : step !== "choose" && view ? (
            <Understanding view={view} runChoice={runChoice} setRunChoice={setRunChoice} />
          ) : analyzing ? (
            <div className="mx-auto flex max-w-[460px] flex-col items-center gap-3 px-6 py-16 text-center" role="status">
              <StatusMark status="building" />
              <h2 className="text-heading font-[650]">Reading {repo}</h2>
              <p className="text-ink-2">Architect reads its file list and key files (package.json, requirements, README, tests and agent code), then works out what it does today. Nothing in the repo changes.</p>
            </div>
          ) : (
            <EmptyState icon="repo" title={repo ? `${repo} is ready to read` : "Choose a repo"}>
              {repo
                ? `Pick a branch and a folder, then click Understand it. Architect reads the code and tells you how it's built, how it starts, the keys it needs, its tests and its agents. ${STACK_NOTE}`
                : `Choose one of the repos the GitHub App can read, on the left. ${STACK_NOTE}`}
            </EmptyState>
          )}
        </main>
      </div>
    </div>
  );
}
