"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ax/button";
import { Tag } from "@/components/ax/pill";
import { Select } from "@/components/ax/select";
import type { Role } from "@/lib/db";
import { ROLE_INFO } from "@/lib/permissions";
import { changeRole, inviteMember, removeMember, resendInvite } from "@/server/actions/members";

export type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  invited: boolean;
  isYou: boolean;
  changeBlockedReason?: string;
  inviteLink?: string;
};

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        Invite link
      </label>
      <input id={id} readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-h-8 min-w-0 flex-1 rounded-full border border-line bg-tray px-3 font-mono text-small text-ink-2" />
      <Button
        size="sm"
        icon="copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard blocked: the field is selectable instead.
          }
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}

function MemberItem({ m, canManage, assignable }: { m: MemberRow; canManage: boolean; assignable: Exclude<Role, "owner">[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const selectId = useId();
  const blocked = !canManage || Boolean(m.changeBlockedReason);
  const options = blocked ? [m.role] : Array.from(new Set([m.role, ...assignable]));

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      setError(undefined);
      const r = await fn();
      if (!r.ok) setError(r.message);
    });

  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-[30px] flex-none place-items-center rounded-full bg-tray text-small font-bold" aria-hidden="true">
          {m.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2 font-semibold">
            <span className="truncate">{m.name}</span>
            {m.isYou && <Tag>You</Tag>}
            {m.invited && <Tag>Invited</Tag>}
          </span>
          <span className="truncate text-small text-ink-2">{m.email}</span>
        </div>
        <label htmlFor={selectId} className="sr-only">
          Role for {m.name}
        </label>
        <Select
          id={selectId}
          value={m.role}
          aria-disabled={blocked || pending || undefined}
          title={m.changeBlockedReason ?? (canManage ? undefined : "Only Owners and Admins can change roles.")}
          onChange={(e) => {
            if (blocked) return;
            const role = e.target.value;
            run(() => changeRole({ memberId: m.id, role }));
          }}
        >
          {options.map((r) => (
            <option key={r} value={r} disabled={blocked && r !== m.role}>
              {ROLE_INFO[r].label}
            </option>
          ))}
        </Select>
        {canManage && !m.changeBlockedReason && (
          <Button size="sm" variant="quiet" onClick={() => run(() => removeMember({ memberId: m.id }))}>
            {m.invited ? "Cancel invite" : "Remove"}
          </Button>
        )}
      </div>
      {m.invited && m.inviteLink && <CopyLink link={m.inviteLink} />}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </li>
  );
}

/** A pending invite: who, as what, its link, and Resend link (a fresh link; the old one stops working) or Revoke. */
function PendingItem({ m, canManage }: { m: MemberRow; canManage: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [link, setLink] = useState(m.inviteLink);
  const [note, setNote] = useState<string>();
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{m.name !== m.email ? m.name : m.email}</span>
          <span className="truncate text-small text-ink-2">
            {m.name !== m.email ? `${m.email} · ` : ""}Invited as {ROLE_INFO[m.role].label}
          </span>
        </div>
        {canManage && (
          <>
            <Button
              size="sm"
              disabledReason={pending ? "Making a new link…" : undefined}
              onClick={() =>
                start(async () => {
                  setError(undefined);
                  const r = await resendInvite({ memberId: m.id });
                  if (!r.ok) return setError(r.message);
                  setLink(r.link);
                  setNote(r.emailed ? "New link made and emailed. The old link no longer works." : "New link made. Send it to them; the old link no longer works.");
                })
              }
            >
              Resend link
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabledReason={pending ? "Revoking…" : undefined}
              onClick={() =>
                start(async () => {
                  setError(undefined);
                  const r = await removeMember({ memberId: m.id });
                  if (!r.ok) setError(r.message);
                })
              }
            >
              Revoke
            </Button>
          </>
        )}
      </div>
      {canManage && link && <CopyLink link={link} />}
      {note && (
        <p role="status" className="text-small text-ink-2">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </li>
  );
}

export function MembersSection({
  workspaceName,
  members,
  canManage,
  assignable,
}: {
  workspaceName: string;
  members: MemberRow[];
  canManage: boolean;
  assignable: Exclude<Role, "owner">[];
}) {
  const [role, setRole] = useState<Exclude<Role, "owner">>("viewer");
  const [result, setResult] = useState<{ link?: string; emailed?: boolean; error?: string }>({});
  const [pending, start] = useTransition();
  const emailId = useId();
  const roleId = useId();
  const active = members.filter((m) => !m.invited);
  const invited = members.filter((m) => m.invited);

  // Reads the email from the form on submit, so text typed before the page finished loading still counts.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) {
      setResult({ error: "Enter their email first." });
      return;
    }
    start(async () => {
      const r = await inviteMember({ email, role });
      if (r.ok) {
        setResult({ link: r.link, emailed: r.emailed });
        form.reset();
      } else setResult({ error: r.message });
    });
  };

  return (
    <section aria-labelledby="people" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="people" className="text-heading font-[650]">
          People in {workspaceName}
        </h2>
        {!canManage && <p className="text-ink-2">Only Owners and Admins can invite people or change roles.</p>}
      </div>

      {canManage && (
        <form onSubmit={submit} className="flex flex-col gap-3 rounded-card border border-line bg-tray p-4">
          <h3 className="font-semibold">Invite someone</h3>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <label htmlFor={emailId} className="text-small font-semibold">
                Email
              </label>
              <input
                id={emailId}
                name="email"
                type="email"
                placeholder="sam@company.com"
                autoComplete="off"
                className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-4 placeholder:text-ink-3"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={roleId} className="text-small font-semibold">
                Role
              </label>
              <Select id={roleId} controlSize="md" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                {assignable.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_INFO[r].label}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="primary" disabledReason={pending ? "Creating the link…" : undefined}>
              {pending ? "Creating…" : "Create invite link"}
            </Button>
          </div>
          <p className="text-small text-ink-2">
            {ROLE_INFO[role].label}: {ROLE_INFO[role].can} Send them the link yourself; it only works for the email you enter.
          </p>
          {result.link && (
            <div role="status" className="flex flex-col gap-1.5">
              <span className="text-small font-semibold">{result.emailed ? "Invite emailed. The link, in case they need it:" : "Invite link ready. Send it to them:"}</span>
              <CopyLink link={result.link} />
            </div>
          )}
          {result.error && (
            <p role="alert" className="text-small font-semibold text-failed">
              {result.error}
            </p>
          )}
        </form>
      )}

      <h3 className="flex items-baseline gap-2 font-semibold">
        Members <span className="text-small font-normal text-ink-2 tabular-nums">{active.length}</span>
      </h3>
      <ul aria-label="Members" className="flex flex-col gap-1.5 rounded-pane border border-line bg-tray p-1.5">
        {active.map((m) => (
          <MemberItem key={m.id} m={m} canManage={canManage} assignable={assignable} />
        ))}
      </ul>

      <h3 className="flex items-baseline gap-2 font-semibold">
        Pending invites <span className="text-small font-normal text-ink-2 tabular-nums">{invited.length}</span>
      </h3>
      {invited.length ? (
        <ul aria-label="Pending invites" className="flex flex-col gap-1.5 rounded-pane border border-line bg-tray p-1.5">
          {invited.map((m) => (
            <PendingItem key={m.id} m={m} canManage={canManage} />
          ))}
        </ul>
      ) : (
        <p className="text-small text-ink-2">No invites waiting. A new invite shows here until they join.</p>
      )}
    </section>
  );
}
