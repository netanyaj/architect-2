"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { create } from "zustand";
import { TourEngine, findTarget, useTour, type TourApi, type TourChapterDef, type TourStepDef } from "@/components/tour";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ARCHITECTURE_URL, README_URL, VIDEO_URL } from "@/lib/links";
import { CHAPTER_TITLE, type Chapter, type TourView } from "@/lib/tour";
import { beginTour, finishTour, saveTourProgress, skipTour, takeTour, tourState } from "@/server/actions/tour";
import { buttonClasses } from "./button";
import { Icon } from "./icon";

/*
 * The tour (round 7): three chapters on the adapted shadcn tour engine (src/components/tour.tsx). It starts on everyone's
 * first sign-in with a welcome; Next performs each step's action on the real control; Skip is always there; "Take the
 * tour" stays in the side nav, Resources and ⌘K. Where the person is lives in a client store that outlives page
 * changes (each page group mounts its own host), and is saved to user_preferences.tour at each step.
 */

type Runtime = {
  view: TourView | null;
  /** Mid-tour: the chapter and step to show. Null: no tour running. */
  at: { chapter: Chapter; step: string } | null;
  projectId: string | null;
  /** Steps whose action is done: Back and Next never do them again. */
  acted: string[];
  welcomeOpen: boolean;
  /** Bumped to remount the engine at `at` (a start, a resume). */
  run: number;
  seeded: boolean;
};

const useRuntime = create<Runtime>(() => ({ view: null, at: null, projectId: null, acted: [], welcomeOpen: false, run: 0, seeded: false }));

/** The tour is running: project pages keep Parts and Chat open while it is. */
export const useTourActive = () => useRuntime((s) => Boolean(s.at));

const moveTo = (chapter: Chapter, step: string) => useRuntime.setState({ at: { chapter, step } });

type Guide = { available: boolean; take: () => Promise<void> };
const GuideContext = createContext<Guide>({ available: false, take: async () => {} });

/** Take the tour (side nav, Resources, ⌘K). */
export const useTourGuide = () => useContext(GuideContext);

const UUID = /^\/p\/([0-9a-f-]{36})/;

/** View state for a project step: no part drawer left open (Open this part opens one). */
async function closeDrawers() {
  if (!document.querySelector('[role="dialog"]:not([data-tour-card])')) return;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(300);
}
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** A button on the page by its words (for controls drawn by other lanes' components). */
function buttonByText(scope: ParentNode, text: RegExp): HTMLElement | null {
  for (const b of scope.querySelectorAll<HTMLElement>("button, a")) {
    const label = `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`;
    if (text.test(label) && b.getBoundingClientRect().width > 0) return b;
  }
  return null;
}

/** The three chapters, for this person and workspace. Steps for pages they can't see are left out. */
function buildChapters(view: TourView, rt: { projectId: string | null }): TourChapterDef[] {
  const pid = rt.projectId;
  const admin = view.role === "owner" || view.role === "admin";
  const gov = view.governance;
  const projectPage = (suffix = "") => (pid ? `/p/${pid}${suffix}` : undefined);

  const story: TourStepDef[] = [
    {
      id: "home",
      page: "/home?tour=plan",
      target: "composer",
      newIn2: true,
      title: "Describe the app once",
      content: (
        <>
          <p>Architect 2.0 turns one prompt into a plan you can read and price, then builds it and proves each part.</p>
          <p>The prompt is filled in for you. You can also attach files or agents, pick the model, or speak it.</p>
        </>
      ),
      nextLabel: "Write the plan",
      onNext: async (api) => {
        // The plan opens on its own page: the tour moves to the next step first, so that page picks it up.
        // The prompt is in the box before the click (it fills in as Home opens with the tour's prompt).
        await api.waitFor(() => Boolean(document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.value.trim()), 15_000, "The prompt");
        moveTo("story", "plan");
        await api.click("write-plan");
        await api.waitFor(() => UUID.test(window.location.pathname), 60_000, "The plan");
      },
    },
    {
      id: "plan",
      page: projectPage("?view=plan"),
      target: "plan-doc",
      newIn2: true,
      title: "The plan comes first",
      content: <p>Parts in plain words, each with the check that proves it and what it costs, and the total before anything is spent. Next waits for the plan to finish.</p>,
      onNext: async (api) => {
        await api.waitFor(() => /^Build · ~\d+ credits$/.test(api.find("build")?.textContent?.trim() ?? ""), 180_000, "The finished plan");
      },
    },
    {
      id: "question",
      page: projectPage("?view=plan"),
      target: "question",
      waitMs: 5_000,
      title: "A question, and a change",
      content: (
        <>
          <p>Architect asks only what it can&apos;t guess, with a recommended answer. Ask for a change in chat and it comes back as a change card with its cost.</p>
        </>
      ),
      nextLabel: "Use the recommended answer",
      onNext: async (api) => {
        const group = api.find("question");
        const pick = group && buttonByText(group, /recommended/i);
        if (pick) await api.clickElement(pick);
      },
    },
    {
      id: "design",
      page: projectPage("?view=plan"),
      // Before a build the look is in the plan's "Data, sign-in and look" group; after one, Plan › Design shows it. A plan
      // without that group (the model decides) shows its stack, with its database and sign-in.
      target: 'css:#group-data, [data-tour="plan-design"] || plan-stack',
      newIn2: true,
      title: "The look, before building",
      content: <p>Data, sign-in and the app&apos;s look are parts of the plan too, chosen before anything is built. After the build, Plan › Design shows the look and feel, and you can change it in chat.</p>,
    },
    {
      id: "build",
      page: projectPage("?view=plan"),
      target: "build",
      doneTarget: 'css:aside[aria-label="Parts"]',
      newIn2: true,
      title: "Build, at the price you saw",
      content: <p>The button says what it costs. Nothing is built or charged before this click. Next clicks it for you.</p>,
      nextLabel: "Build it",
      onNext: async (api) => {
        await api.click("build");
        // The App view opens, the live preview, with Parts and Chat open.
        await api.waitFor(() => !window.location.search.includes("view=plan") && Boolean(document.querySelector('aside[aria-label="Parts"]')) && Boolean(document.querySelector('aside[aria-label="Chat"]')), 30_000, "The App view");
      },
    },
    {
      id: "proof",
      page: projectPage(),
      prepare: closeDrawers,
      target: "part-works",
      waitMs: 150_000,
      newIn2: true,
      title: "Proof per part",
      content: <p>A part turns Works only when its own check passes. Open one to see the check and its proof.</p>,
      nextLabel: "Open this part",
      onNext: async (api) => {
        await api.click("part-works");
        await sleep(900);
      },
    },
    {
      id: "blocker",
      page: projectPage(),
      prepare: closeDrawers,
      target: "blocker",
      doneTarget: "part-works",
      waitMs: 150_000,
      newIn2: true,
      title: "A blocker you can fix",
      content: <p>A part waits for Gmail. Connect it (here, with sample data) and the build carries on. Everything else kept building.</p>,
      nextLabel: "Connect it",
      onNext: async (api) => {
        // Close the part's drawer first, if it's open.
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(350);
        await api.click("blocker");
        await api.click("connect-allow", { timeout: 8_000 });
        await api.waitFor(() => !findTarget("connect-allow"), 15_000, "The connection");
      },
    },
    {
      id: "connections",
      page: "/connections",
      target: "connections",
      title: "Connections",
      content: <p>Sign-in apps, API keys, MCP servers and the workspace&apos;s own Lyzr key. Connect once and every project can use it.</p>,
    },
    {
      id: "preview",
      page: projectPage(),
      prepare: closeDrawers,
      target: "stage",
      title: "The live preview",
      content: <p>Phone or desktop, Light or Dark, and Point at something: pick any part of the app and it goes into chat, ready to change.</p>,
      nextLabel: "Point at something",
      onNext: async (api) => {
        const point = buttonByText(document, /^\s*Point at something/i);
        if (!point) return;
        await api.clickElement(point);
        await sleep(400);
        // Pick something in the app: its words go into the chat box.
        const frame = document.querySelector<HTMLIFrameElement>('[data-tour="stage"] iframe');
        const pickable = frame?.contentDocument?.querySelector<HTMLElement>("h1, h2, h3, button, [data-part]");
        pickable?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        pickable?.click();
        await api.waitFor(() => Boolean(document.querySelector<HTMLTextAreaElement>('[data-tour="chat-composer"] textarea')?.value), 5_000).catch(() => {});
      },
    },
    {
      id: "agents",
      page: projectPage("?view=agents"),
      target: "stage",
      newIn2: true,
      title: "Agents",
      content: (
        <p>
          The graph of the app&apos;s agents and the apps they use. Its trigger is the schedule (simulated here). Try any agent on Lyzr Studio, and bring agents built with CrewAI or LangGraph: keep them as they are, convert them to Studio, or wrap them as a tool.
        </p>
      ),
    },
    // 11a: Developer view, inside the project. Next turns it on (Code, with what changed), then opens Terminal.
    {
      id: "developer",
      page: projectPage(),
      prepare: closeDrawers,
      target: "dev-toggle",
      count: 11,
      title: "Developer view",
      content: <p>For developers: the code behind every part, a terminal and the console, with the same plan and checks.</p>,
      nextLabel: "Open Developer view",
      onNext: async (api) => {
        await api.click("dev-toggle");
        await api.waitFor(() => new URLSearchParams(window.location.search).get("dev") === "1", 15_000, "Developer view");
      },
    },
    {
      id: "dev-code",
      page: projectPage("?dev=1"),
      target: 'css:aside[aria-label="Files"]',
      count: 11,
      title: "Developer view: Code",
      content: <p>Every part&apos;s code, grouped by part, with what changed in each file. Edit a file here and its part&apos;s check runs again.</p>,
      nextLabel: "Open Terminal",
      onNext: async (api) => {
        // The Stage view tabs' "Terminal & logs".
        const tabs = document.querySelector('[aria-label="Stage view"]') ?? document;
        const tab = buttonByText(tabs, /^\s*Terminal/);
        if (tab) await api.clickElement(tab);
        await api.waitFor(() => new URLSearchParams(window.location.search).get("view") === "terminal", 15_000, "The terminal");
      },
    },
    // 11b: where the code lives.
    {
      id: "dev-repo",
      page: projectPage("?dev=1&view=terminal"),
      target: "dev-repo",
      count: 12,
      title: "Your repo, branches and PRs",
      content: <p>Projects can live in your own GitHub repo; changes come back as PRs. To bring an existing repo in, use Import a repo on Home.</p>,
    },
    {
      id: "launch",
      page: projectPage("/launch"),
      target: "launch-action",
      newIn2: true,
      title: "Launch",
      content: gov ? (
        <p>Here governance is on: Test, then a Team version, then Live. When a Builder asks for Live, it waits for an Owner or Admin; you&apos;re the Owner, so yours goes live now. With governance off, Test goes straight to Live.</p>
      ) : (
        <p>Here governance is off: Test goes straight to Live. With governance on, there&apos;s a Team version first, and Live waits for an Owner or Admin to approve it.</p>
      ),
      nextLabel: "Go live",
      onNext: async (api) => {
        // With governance on, the team version comes first; then Go live asks for the approval. Each click settles
        // (the button's words change and it's enabled again) before the next one.
        const label = () => api.find("launch-action")?.textContent?.trim() ?? "";
        const enabled = () => Boolean(api.find("launch-action")) && !api.find("launch-action")?.getAttribute("aria-disabled");
        for (let i = 0; i < 3; i++) {
          await api.waitFor(enabled, 30_000, "The launch button").catch(() => {});
          const before = label();
          if (!enabled()) break;
          await api.clickElement(api.find("launch-action")!);
          if (/live/i.test(before)) break;
          await api.waitFor(() => enabled() && label() !== before, 45_000, "The team version").catch(() => {});
        }
      },
    },
    ...(gov && admin
      ? [
          {
            id: "approvals",
            page: "/governance/approvals",
            target: "approve",
            doneTarget: 'css:section[aria-label="Requests"]',
            title: "Approvals",
            content: <p>Sam, a Builder, asked to make ticket-triage live. It waits here for an Owner or Admin, so it&apos;s yours to approve.</p>,
            nextLabel: "Approve it",
            onNext: async (api: TourApi) => {
              await api.click("approve");
              await api.waitFor(() => /Approved/.test(document.body.textContent ?? ""), 15_000, "The approval");
            },
          } satisfies TourStepDef,
        ]
      : []),
    gov && admin
      ? {
          id: "governance",
          page: "/governance",
          target: 'css:section[aria-label="Policies"]',
          newIn2: true,
          title: "Governance",
          content: <p>Where apps run, the allowed models, apps and MCP servers, budgets, and the audit log, which has every run, change and approval you just made.</p>,
        }
      : {
          id: "governance",
          page: "/settings/governance",
          target: 'css:section[aria-labelledby="governance"]',
          newIn2: true,
          title: gov ? "Governance" : "Governance is off here",
          content: gov ? (
            <p>Owners and Admins set the company&apos;s rules: where apps run, allowed models and apps, budgets, approvals for Live, and the audit log.</p>
          ) : (
            <p>Turning governance on adds Approvals and Governance: where apps run, which models and apps are allowed, budgets, approvals for Live, and an audit log of everything.</p>
          ),
        },
  ];

  // Chapter 2: one card per page, using the nav's exact labels. The card goes to the page and lights up its nav item.
  const nav: { key: string; label: string; href: string; line: string; show?: boolean }[] = [
    { key: "home", label: "Home", href: "/home", line: "Start here: describe an app, or pick up where you left off. Import a repo is here too: bring in an existing GitHub repo, and its tests become proof." },
    { key: "projects", label: "Projects", href: "/projects", line: "Every app you've planned or built, with what each one needs from you next. New project is at the top." },
    { key: "agents", label: "Agents", href: "/agents", line: "All the agents across your projects, including ones from Lyzr Studio or other frameworks. Each shows up once its part is built: open it to edit it, set its schedule, or try it on Lyzr Studio." },
    { key: "connections", label: "Connections", href: "/connections", line: "The apps, API keys, MCP servers and Lyzr key your projects use. Connect once and any project can use it; each section has its own Add button." },
    { key: "marketplace", label: "Marketplace", href: "/marketplace", line: "Templates and ready-made agents to start from, and where your team's published apps appear. Pick one and its prompt fills the composer on Home." },
    { key: "usage", label: "Usage", href: "/usage", line: "Credits by project and by build, against each budget, so cost is never a surprise. The credits meter in the nav shows what's left." },
    { key: "approvals", label: "Approvals", href: "/governance/approvals", line: "You saw approvals in action. This is where they wait for an Owner or Admin: Live launches, new apps and more.", show: gov && admin },
    { key: "governance", label: "Governance", href: "/governance", line: "The company's rules: where apps run, the allowed models and apps, budgets, and the audit log at the end of the list.", show: gov && admin },
  ];
  const around: TourStepDef[] = nav
    .filter((x) => x.show !== false)
    .map((item) => ({ id: `nav-${item.key}`, page: item.href, target: `nav-${item.key}`, waitMs: 1_500, title: item.label, content: <p>{item.line}</p> }));
  const settingsCount = around.length + 1;
  around.push(
    {
      id: "settings",
      page: "/settings",
      target: "nav-settings",
      waitMs: 1_500,
      count: settingsCount,
      title: "Settings",
      content: (
        <p>
          Workspace and personal settings, from the account menu.{gov ? "" : " Turning governance on here adds Approvals and Governance to the nav."}
        </p>
      ),
    },
    {
      id: "settings-menu",
      page: "/settings",
      target: 'css:nav[aria-label="Settings"]',
      count: settingsCount,
      title: "Settings",
      content: (
        <>
          <p>Turn Governance on or off, link GitHub, reset the Demo data, and choose the theme in Appearance.</p>
          <p>Docs, What&apos;s new, Trash and the community live in Resources, next to your account.</p>
        </>
      ),
    },
  );

  const finish: TourStepDef[] = [
    {
      id: "help",
      target: "help",
      waitMs: 3_000,
      title: "Help and ⌘K",
      content: <p>Help answers questions about Architect and about your own projects. ⌘K finds any project, agent, connection or page.</p>,
    },
    {
      id: "finish",
      title: "You've seen the whole story",
      content: <FinishBody canResetDemo={view.canResetDemo} />,
      nextLabel: "Explore on your own",
    },
  ];

  return [
    { id: "story", title: CHAPTER_TITLE.story, steps: story },
    { id: "around", title: CHAPTER_TITLE.around, steps: around },
    { id: "finish", title: CHAPTER_TITLE.finish, steps: finish },
  ];
}

/** The last step's links, and Reset demo data for the Owner. "Take the tour" stays in the side nav. */
function FinishBody({ canResetDemo }: { canResetDemo: boolean }) {
  const router = useRouter();
  const tour = useTour();
  const link = "inline-flex min-h-6 items-center gap-1 font-semibold text-ink underline decoration-line-ctl underline-offset-[3px] hover:decoration-ink";
  return (
    <>
      <p>A plan before any build, a part proved by its check, a blocker fixed, a launch approved, and where everything lives. Take the tour stays in the side nav.</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-small">
        {VIDEO_URL ? (
          <a href={VIDEO_URL} target="_blank" rel="noreferrer" className={link}>
            Watch the video
            <Icon name="external" size="sm" className="text-ink-3" />
          </a>
        ) : (
          <span className="inline-flex min-h-6 items-center text-ink-3" title="The walkthrough video isn't published yet.">
            Video (soon)
          </span>
        )}
        <a href={README_URL} target="_blank" rel="noreferrer" className={link}>
          Read the README
          <Icon name="external" size="sm" className="text-ink-3" />
        </a>
        <a href={ARCHITECTURE_URL} target="_blank" rel="noreferrer" className={link}>
          See the architecture
          <Icon name="external" size="sm" className="text-ink-3" />
        </a>
      </div>
      {canResetDemo && (
        <button
          type="button"
          onClick={async () => {
            tour.stop();
            useRuntime.setState({ at: null });
            await finishTour("reset");
            router.push("/settings/demo");
          }}
          className={`${buttonClasses({ size: "sm" })} self-start`}
        >
          Reset demo data
        </button>
      )}
    </>
  );
}

/** The welcome, on first sign-in (and Take the tour after finishing): what Architect 2.0 is, Start the tour or Skip. */
function Welcome({ view, onStart, onSkip }: { view: TourView; onStart: () => void; onSkip: () => void }) {
  const open = useRuntime((s) => s.welcomeOpen);
  const [pending, setPending] = useState(false);
  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-[440px] gap-4 rounded-pane border border-line bg-surface p-6 shadow-pop">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-full bg-selected text-ink">
          <Icon name="sparkle" />
        </span>
        <AlertDialogTitle className="text-heading font-[650]">Welcome to Architect 2.0</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="flex flex-col gap-2 text-ink-2">
            <p>Describe an app once: Architect writes the plan and its cost, builds it, proves each part, and launches it through your company&apos;s rules.</p>
            <p>The tour walks the whole story in your own Acme Ops workspace, about 6 minutes. Skip it any time; Take the tour stays in the side nav.</p>
            {view.demoVisitor && <p>You&apos;re in the demo as Morgan, an Owner. This workspace is deleted after 7 days.</p>}
            <p className="text-small md:hidden">Best on a laptop: the tour shows the plan, the build and the preview side by side.</p>
          </div>
        </AlertDialogDescription>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (pending) return;
              setPending(true);
              onStart();
            }}
            className={buttonClasses({ variant: "primary" })}
          >
            {pending ? "Starting…" : "Start the tour"}
          </button>
          <button type="button" onClick={onSkip} className={buttonClasses({})}>
            Skip
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

type Position = { chapter: Chapter; step: string; projectId: string | null; acted: string[] };
const tabKey = (userId: string) => `architect-tour:${userId}`;

/**
 * The tab's own copy of where the tour is, written at once at each step. Saves to the server run one at a time, so a reload
 * straight after Next or Back can cut off the newest; resuming in this tab reads this copy first.
 */
function keepPosition(userId: string | undefined, p: Position | null) {
  if (!userId) return;
  try {
    if (p) sessionStorage.setItem(tabKey(userId), JSON.stringify(p));
    else sessionStorage.removeItem(tabKey(userId));
  } catch {
    // Storage can be off (a private window); the server's copy still resumes the tour.
  }
}

function keptPosition(userId: string): Position | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(tabKey(userId)) ?? "null") as Position | null;
    return p && typeof p.step === "string" && typeof p.chapter === "string" && Array.isArray(p.acted) ? p : null;
  } catch {
    return null;
  }
}

/** Where the tour is: kept in the tab at once, and saved for the person. */
function save(p: Position) {
  keepPosition(useRuntime.getState().view?.userId, p);
  void saveTourProgress(p);
}

/**
 * The tour for a page: the server's copy when the page opens, then the client store. Renders the welcome, the engine around the
 * page, and the context for Take the tour.
 */
export function TourProvider({ initial, available, children }: { initial: TourView | null; available: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // Seed once per tab; later pages keep the store, which is ahead of the server while a step is being saved.
  useLayoutEffect(() => {
    const s = useRuntime.getState();
    if (s.seeded) {
      useRuntime.setState({ view: initial });
      return;
    }
    // Mid-tour, this tab's own copy is the newest; otherwise it's stale and goes.
    const kept = initial?.active ? keptPosition(initial.userId) : null;
    if (initial && !initial.active) keepPosition(initial.userId, null);
    useRuntime.setState({
      seeded: true,
      view: initial,
      projectId: kept?.projectId ?? initial?.projectId ?? null,
      acted: kept?.acted ?? initial?.acted ?? [],
      at: kept ? { chapter: kept.chapter, step: kept.step } : initial?.active && initial.chapter ? { chapter: initial.chapter, step: initial.step ?? "home" } : null,
      welcomeOpen: Boolean(initial?.welcome),
      run: s.run + 1,
    });
  }, [initial]);
  const rt = useRuntime();
  const view = rt.view ?? initial;

  // The tour's project: the one its plan opened, read from the address in chapter 1.
  const onProject = UUID.exec(pathname)?.[1] ?? null;
  useLayoutEffect(() => {
    const s = useRuntime.getState();
    if (s.at?.chapter === "story" && onProject && !s.projectId) useRuntime.setState({ projectId: onProject });
  }, [onProject, rt.at?.chapter]);

  const chapters = useMemo(() => (view ? buildChapters(view, { projectId: rt.projectId }) : []), [view, rt.projectId]);

  const start = useCallback(async () => {
    const r = await beginTour();
    keepPosition(useRuntime.getState().view?.userId, null);
    useRuntime.setState({ welcomeOpen: false });
    if (!r.ok) return;
    useRuntime.setState((s) => ({ at: { chapter: "story", step: "home" }, projectId: null, acted: [], run: s.run + 1 }));
    if (r.switched) router.refresh();
  }, [router]);

  const take = useCallback(async () => {
    const r = await takeTour();
    if (!r.ok) return;
    const fresh = await tourState();
    if (r.resume && fresh?.chapter && fresh.step) {
      useRuntime.setState((s) => ({ view: fresh, at: { chapter: fresh.chapter!, step: fresh.step! }, projectId: fresh.projectId, acted: fresh.acted, run: s.run + 1 }));
    } else {
      useRuntime.setState({ view: fresh, at: null, acted: [], welcomeOpen: true });
    }
  }, []);

  const guide = useMemo<Guide>(() => ({ available, take }), [available, take]);
  if (!view) return <GuideContext.Provider value={guide}>{children}</GuideContext.Provider>;

  return (
    <GuideContext.Provider value={guide}>
      <TourEngine
        key={rt.run}
        chapters={chapters}
        initial={rt.at}
        acted={rt.acted}
        onActed={(step) => {
          const s = useRuntime.getState();
          const acted = [...new Set([...s.acted, step])];
          useRuntime.setState({ acted });
          save({ chapter: (s.at?.chapter ?? "story") as Chapter, step: s.at?.step ?? step, projectId: s.projectId, acted });
        }}
        onMove={(chapter, step) => moveTo(chapter as Chapter, step)}
        onStep={(chapter, step) => {
          moveTo(chapter as Chapter, step);
          save({ chapter: chapter as Chapter, step, projectId: useRuntime.getState().projectId, acted: useRuntime.getState().acted });
        }}
        onSkip={(_chapter, step) => {
          keepPosition(view.userId, null);
          useRuntime.setState({ at: null });
          void skipTour(step);
        }}
        onFinish={() => {
          keepPosition(view.userId, null);
          useRuntime.setState({ at: null });
          void finishTour("explore");
        }}
      >
        {children}
      </TourEngine>
      <Welcome
        view={view}
        onStart={() => void start()}
        onSkip={() => {
          keepPosition(view.userId, null);
          useRuntime.setState({ welcomeOpen: false });
          void skipTour("welcome");
        }}
      />
    </GuideContext.Provider>
  );
}
