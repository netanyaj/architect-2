import type { Role } from "./db";

/** Roles from the PRD (section 9), in plain words for Settings and invites. */
export const ROLE_INFO: Record<Role, { label: string; can: string }> = {
  owner: { label: "Owner", can: "Everything, including billing and deleting the workspace." },
  admin: { label: "Admin", can: "Everything except billing, including Live deploys." },
  builder: { label: "Builder", can: "Create and build projects. Share Test and Team versions; ask for Live." },
  viewer: { label: "Viewer", can: "See projects and comment on plan parts. Can't build or change anything." },
};

/** Roles you can give someone by invite or role change. Nobody is made Owner this way. */
export const ASSIGNABLE_ROLES: Exclude<Role, "owner">[] = ["admin", "builder", "viewer"];

/** What `actor` may give: the Owner can make Admins; an Admin can make Builders and Viewers. */
export function assignableRolesFor(actor: Role): Exclude<Role, "owner">[] {
  if (actor === "owner") return ASSIGNABLE_ROLES;
  if (actor === "admin") return ["builder", "viewer"];
  return [];
}

/** Build, Apply and other paid actions (matches can_build() in the database). */
export function canBuild(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "builder";
}

/** Invite, change roles, remove people. */
export function canManageMembers(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Reset demo data: the Owner only. */
export function canResetDemo(role: Role): boolean {
  return role === "owner";
}

/** The reason shown on a Build-type button someone can't press (one place, so every screen says the same). */
export function buildBlockedReason(role: Role): string | undefined {
  return canBuild(role) ? undefined : "Viewers can't build. Ask an Owner, Admin or Builder.";
}

/**
 * Can `actor` change or remove the member `target`?
 * Nobody changes the Owner or themselves, and an Admin can't change another Admin.
 */
export function canChangeMember(
  actor: { role: Role; userId: string },
  target: { role: Role; userId: string | null },
): { ok: true } | { ok: false; reason: string } {
  if (!canManageMembers(actor.role)) return { ok: false, reason: "Only Owners and Admins can change who's in the workspace." };
  if (target.role === "owner") return { ok: false, reason: "The Owner's role can't be changed." };
  if (target.userId && target.userId === actor.userId) return { ok: false, reason: "You can't change your own role." };
  if (actor.role === "admin" && target.role === "admin") return { ok: false, reason: "Only the Owner can change an Admin." };
  return { ok: true };
}
