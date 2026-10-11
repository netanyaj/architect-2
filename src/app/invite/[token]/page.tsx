import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { buttonClasses } from "@/components/ax/button";
import { loginUrl } from "@/lib/auth-paths";
import type { Role } from "@/lib/db";
import { ROLE_INFO } from "@/lib/permissions";
import { signOut } from "@/server/actions/auth";
import { createAdminDb, createServerDb } from "@/server/db";
import { workspaceLabel } from "@/server/workspace";
import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "Invite · Architect" };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-[440px] flex-col gap-5 rounded-pane border border-line bg-surface p-8 shadow-pane max-sm:p-6">
        <div className="flex items-center gap-2.5 text-sub font-bold">
          <span className="grid size-[30px] place-items-center rounded-[9px] bg-primary text-body font-bold text-on-primary" aria-hidden="true">
            A
          </span>
          Architect
        </div>
        <h1 className="text-title font-[650]">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const admin = createAdminDb();
  const invite = z.string().uuid().safeParse(token).success
    ? (
        await admin
          .from("members")
          .select("role, status, invited_email, invited_by, workspaces!inner(name)")
          .eq("invite_token", token)
          .maybeSingle()
      ).data
    : null;

  if (!invite || invite.status !== "invited") {
    return (
      <Card title="This invite link doesn't work any more">
        <p className="text-ink-2">It was already used or cancelled. Ask the person who invited you for a new link.</p>
        <Link href="/home" className={buttonClasses({ className: "self-start" })}>
          Go to Home
        </Link>
      </Card>
    );
  }

  let inviter = "Someone";
  if (invite.invited_by) {
    const { data } = await admin
      .from("members")
      .select("display_name")
      .eq("user_id", invite.invited_by)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (data?.display_name) inviter = data.display_name;
  }

  const role = ROLE_INFO[invite.role as Role];
  // Everyone's demo has the same name, so an invite says whose it is ("Acme Ops (Enterprise) · Morgan's").
  const workspace = workspaceLabel(invite.workspaces.name, inviter === "Someone" ? null : inviter, false);
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  const emailMatches = user && (user.email ?? "").toLowerCase() === (invite.invited_email ?? "").toLowerCase();

  return (
    <Card title={`Join ${workspace}`}>
      <p className="text-ink-2">
        <b className="text-ink">{inviter}</b> invited <b className="text-ink">{invite.invited_email}</b> to {workspace} as{" "}
        <b className="text-ink">{role.label}</b>. {role.can}
      </p>
      {!user && (
        <>
          <Link href={loginUrl(`/invite/${token}`)} className={buttonClasses({ variant: "primary", className: "self-start" })}>
            Sign in to accept
          </Link>
          <p className="text-small text-ink-2">New to Architect? Create an account with {invite.invited_email} on the next screen.</p>
        </>
      )}
      {user && emailMatches && (
        <>
          <AcceptButton token={token} />
          <p className="text-small text-ink-2">Your own workspace stays as it is. You can switch between them from the side nav.</p>
        </>
      )}
      {user && !emailMatches && (
        <>
          <p role="alert" className="rounded-card border-[1.5px] border-attention px-3.5 py-2.5 text-ink">
            You&apos;re signed in as <b>{user.email}</b>. This invite only works for {invite.invited_email}.
          </p>
          <form action={signOut}>
            <button type="submit" className={buttonClasses({ variant: "primary" })}>
              Sign out and switch account
            </button>
          </form>
        </>
      )}
    </Card>
  );
}
