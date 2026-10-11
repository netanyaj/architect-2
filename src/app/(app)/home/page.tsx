import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses, TextLink } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { ListRow, Tray } from "@/components/ax/list-row";
import { StatusLine } from "@/components/ax/status-mark";
import { projectHref } from "@/lib/dev-preference";
import { buildBlockedReason, canBuild } from "@/lib/permissions";
import { STARTERS } from "@/lib/templates";
import { modelAvailability } from "@/lib/gateway";
import { modelSetupFor } from "@/server/project";
import { createServerDb } from "@/server/db";
import { listProjects } from "@/server/queries";
import { userOpenInDev } from "@/server/theme";
import { displayNameFor, getAppContext } from "@/server/workspace";
import { HomeComposer } from "./home-composer";
import { IdeaCards } from "./idea-cards";
import { PersonalStart } from "./personal-start";

export const metadata: Metadata = { title: "Home · Architect" };

export default async function HomePage({ searchParams }: PageProps<"/home">) {
  const { starter } = await searchParams;
  const starterPrompt = STARTERS.find((s) => s.id === starter)?.prompt;
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) {
    // Signed out: the composer works, and Write the plan keeps the prompt through sign-in.
    return (
      <div className="flex min-h-dvh flex-col bg-canvas p-2.5">
        <div className="flex flex-1 flex-col rounded-pane border border-line bg-surface shadow-pane">
          <header className="flex items-center gap-2.5 px-6 pt-5 text-sub font-bold">
            <span className="grid size-[30px] place-items-center rounded-[9px] bg-primary text-body font-bold text-on-primary" aria-hidden="true">
              A
            </span>
            Architect
            <span className="flex-1" />
            <Link href="/login" className={buttonClasses({})}>
              Sign in
            </Link>
          </header>
          <div className="mx-auto flex w-full max-w-[880px] flex-col gap-9 px-8 pt-14 pb-10 max-sm:px-4 max-sm:pt-8">
            <HomeComposer signedIn={false} initialPrompt={starterPrompt} models={modelAvailability()} />
          </div>
        </div>
      </div>
    );
  }

  const ctx = await getAppContext();
  const [projects, { options: models, architect, blocked }, pref] = await Promise.all([listProjects(ctx), modelSetupFor(ctx.workspace.id), userOpenInDev()]);
  // Things that need the person first, then the most recently changed.
  const recent = [...projects].sort((a, b) => Number(b.summary.needsYou) - Number(a.summary.needsYou)).slice(0, 3);

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-9 px-8 pt-14 pb-10 max-sm:px-4 max-sm:pt-8">
      <HomeComposer
        signedIn
        firstName={displayNameFor(user).split(" ")[0]}
        startBlockedReason={buildBlockedReason(ctx.role)}
        initialPrompt={starterPrompt}
        models={models}
        blockedModels={blocked}
        defaultModel={architect}
      />

      {ctx.workspace.kind === "personal" && projects.length === 0 && (
        <PersonalStart demoId={ctx.memberships.find((m) => m.role === "owner" && m.kind === "demo")?.workspaceId ?? null} />
      )}

      {recent.length > 0 && (
        <section aria-labelledby="continue" className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <h2 id="continue" className="flex-1 text-sub font-semibold">
              Continue where you left off
            </h2>
            <TextLink href="/projects">All projects</TextLink>
          </div>
          <Tray label="Recent projects">
            {recent.map((p) => (
              <ListRow
                key={p.id}
                icon={p.icon}
                name={p.name}
                meta={p.summary.meta}
                href={projectHref(p.id, { repo: p.repo, pref, canBuild: canBuild(ctx.role) })}
                status={
                  <StatusLine status={p.summary.next.status} icon={p.summary.next.icon}>
                    {p.summary.next.text}
                  </StatusLine>
                }
                trailing={<Icon name="chevronRight" size="sm" className="text-ink-3" />}
              />
            ))}
          </Tray>
        </section>
      )}

      <section aria-labelledby="ideas" className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <h2 id="ideas" className="flex-1 text-sub font-semibold">
            Start from a working idea
          </h2>
          <TextLink href="/marketplace">Browse Marketplace</TextLink>
        </div>
        <IdeaCards />
      </section>
    </div>
  );
}
