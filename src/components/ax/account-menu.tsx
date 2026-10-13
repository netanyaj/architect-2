"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Role } from "@/lib/db";
import { assignableRolesFor, canManageMembers, ROLE_INFO } from "@/lib/permissions";
import type { WorkspacePlan } from "@/lib/plans";
import { signOut } from "@/server/actions/auth";
import { inviteMember, switchWorkspace } from "@/server/actions/members";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";
import { Select } from "./select";
import { NewWorkspaceDialog, type WorkspaceOption } from "./workspace-switcher";

const item = "flex min-h-10 items-center gap-2.5 rounded-tile px-2.5";
const PLAN_WORD: Record<WorkspacePlan, string> = { free: "Free", starter: "Starter", pro: "Pro", enterprise: "Enterprise" };

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function Row({ icon, children, onSelect, disabledReason }: { icon: IconName; children: React.ReactNode; onSelect: () => void; disabledReason?: string }) {
  return (
    <DropdownMenuItem className={item} disabled={Boolean(disabledReason)} title={disabledReason} onSelect={onSelect}>
      <Icon name={icon} size="sm" className="text-ink-2" />
      {children}
    </DropdownMenuItem>
  );
}

/**
 * The account chip at the foot of the nav (M5.8, Notion's pattern): avatar, the workspace's name and ▾. Its menu holds
 * the workspace (plan and people, Settings, Invite people, Governance for admins), who you are and your workspaces
 * (a check on the current one, a role tag where you aren't the Owner, New workspace), then Log out. Plain rows only.
 */
export function AccountMenu({
  name,
  email,
  current,
  options,
  plan,
  memberCount,
  governance,
}: {
  name: string;
  email: string;
  current: string;
  options: WorkspaceOption[];
  plan: WorkspacePlan;
  memberCount: number;
  governance: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const active = options.find((o) => o.workspaceId === current);
  const role = active?.role ?? "viewer";
  const admin = canManageMembers(role);
  const wsName = active?.label ?? "Workspace";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          data-tour="nav-settings"
          aria-label={`Account and workspace: ${wsName}`}
          disabled={pending}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-card px-2 py-1.5 text-left hover:bg-selected"
        >
          <span className="grid size-[28px] flex-none place-items-center rounded-full border border-line bg-surface text-small font-bold" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{wsName}</span>
          <Icon name="chevronDown" size="sm" className="text-ink-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-[284px] rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <div className="flex flex-col px-2.5 py-1.5">
            <span className="truncate font-semibold">{wsName}</span>
            <span className="text-small text-ink-2 tabular-nums">
              {PLAN_WORD[plan]} · {memberCount} {memberCount === 1 ? "member" : "members"}
            </span>
          </div>
          <Row icon="settings" onSelect={() => router.push("/settings")}>
            Settings
          </Row>
          <Row icon="invite" onSelect={() => setInviting(true)} disabledReason={admin ? undefined : "Only Owners and Admins can invite people."}>
            Invite people
          </Row>
          {admin && governance && (
            <Row icon="governance" onSelect={() => router.push("/governance")}>
              Governance
            </Row>
          )}
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuLabel className="truncate px-2.5 py-1 text-small font-[600] text-ink-2">{email}</DropdownMenuLabel>
          {options.map((o) => (
            <DropdownMenuItem
              key={o.workspaceId}
              className={item}
              onSelect={() =>
                o.workspaceId !== current &&
                start(async () => {
                  const r = await switchWorkspace(o.workspaceId);
                  if (r.ok) router.push("/home");
                })
              }
            >
              <span className="grid size-[22px] flex-none place-items-center rounded-[7px] border border-line bg-tray text-small font-bold" aria-hidden="true">
                {o.label.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.role !== "owner" && <span className="rounded-full border border-line px-1.5 text-small leading-5 text-ink-2">{ROLE_INFO[o.role].label}</span>}
              {o.workspaceId === current ? <Icon name="check" size="sm" aria-label="Current" /> : <span className="w-[15px]" aria-hidden="true" />}
            </DropdownMenuItem>
          ))}
          <Row icon="plus" onSelect={() => setCreating(true)}>
            New workspace
          </Row>
          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <Row icon="logout" onSelect={() => start(() => signOut())}>
            Log out
          </Row>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewWorkspaceDialog open={creating} onOpenChange={setCreating} />
      {inviting && <InviteDialog role={role} workspaceName={wsName} onClose={() => setInviting(false)} />}
    </>
  );
}

/** Invite people: an email and a role make a link, copied straight away (invites are shared by link, not emailed). */
function InviteDialog({ role, workspaceName, onClose }: { role: Role; workspaceName: string; onClose: () => void }) {
  const id = useId();
  const roles = assignableRolesFor(role);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [link, setLink] = useState<string>();
  const [copied, setCopied] = useState(false);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    start(async () => {
      setError(undefined);
      const r = await inviteMember({ email: String(f.get("email") ?? ""), role: String(f.get("role") ?? "builder") });
      if (!r.ok) return setError(r.message);
      setLink(r.link);
      try {
        await navigator.clipboard.writeText(r.link);
        setCopied(true);
      } catch {
        // Clipboard blocked: the link is shown to copy by hand.
      }
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]">
        <DialogTitle className="text-sub font-semibold">Invite people to {workspaceName}</DialogTitle>
        <DialogDescription className="text-ink-2">The link works only for the email you enter. Send it to them yourself.</DialogDescription>
        {link ? (
          <div className="flex flex-col gap-2">
            <p role="status" className="font-semibold">
              {copied ? "Invite link copied." : "Copy the invite link:"}
            </p>
            <input readOnly value={link} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} className="min-h-8 rounded-full border border-line bg-tray px-3 font-mono text-small text-ink-2" />
            <Button className="self-start" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label htmlFor={`${id}-email`} className="text-small font-semibold">
              Email
            </label>
            <input id={`${id}-email`} name="email" type="email" required autoComplete="off" placeholder="name@company.com" className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-4" />
            <label htmlFor={`${id}-role`} className="text-small font-semibold">
              Role
            </label>
            <Select id={`${id}-role`} name="role" controlSize="md" defaultValue={roles.includes("builder") ? "builder" : roles[0]} wrapperClassName="self-start">
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_INFO[r].label}
                </option>
              ))}
            </Select>
            {error && (
              <p role="alert" className="text-small font-semibold text-failed">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" className="mt-1 self-start" disabledReason={pending ? "Making the link…" : undefined}>
              Copy invite link
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
