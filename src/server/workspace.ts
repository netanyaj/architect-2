import "server-only";

import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { loginUrl } from "@/lib/auth-paths";
import type { Role } from "@/lib/db";
import { createAdminDb, createServerDb, type AdminDb } from "./db";

/** Cookie holding the workspace the person last chose (they can belong to several after accepting invites). */
export const WORKSPACE_COOKIE = "ax_ws";

export function displayNameFor(user: Pick<User, "email" | "user_metadata">): string {
  const meta = user.user_metadata ?? {};
  const fromMeta = [meta.full_name, meta.name, meta.user_name].find((v) => typeof v === "string" && v.trim());
  if (fromMeta) return String(fromMeta).trim();
  const local = user.email?.split("@")[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "You";
}

/**
 * Every person gets their own seeded "Acme Ops" on first sign-in. Idempotent in the database
 * (create_demo_workspace returns the workspace they already own), so it's safe to call on every sign-in.
 */
export async function ensureWorkspace(admin: AdminDb, user: Pick<User, "id" | "email" | "user_metadata">): Promise<string> {
  const { data, error } = await admin.rpc("create_demo_workspace", {
    p_user: user.id,
    p_email: user.email ?? "",
    p_name: displayNameFor(user),
  });
  if (error || !data) throw new Error(`Couldn't set up your workspace: ${error?.message ?? "no workspace returned"}`);
  return data;
}

export type Membership = {
  workspaceId: string;
  workspaceName: string;
  role: Role;
  /** "Your Acme Ops" or "Morgan's Acme Ops": every person's demo workspace has the same name. */
  label: string;
};

export type AppContext = {
  user: User;
  name: string;
  workspace: { id: string; name: string; governanceEnabled: boolean; creditsTotal: number; creditsResetOn: string };
  role: Role;
  memberships: Membership[];
};

/** Picks the chosen workspace if the person still belongs to it, else the one they own, else the first. */
export function pickWorkspace(memberships: Membership[], chosen: string | undefined): Membership | undefined {
  return (
    memberships.find((m) => m.workspaceId === chosen) ??
    memberships.find((m) => m.role === "owner") ??
    memberships[0]
  );
}

/**
 * The signed-in person, their current workspace and role. Redirects to /login when signed out.
 * Cached per request.
 */
export const getAppContext = cache(async (): Promise<AppContext> => {
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect(loginUrl());

  const load = () =>
    db
      .from("members")
      .select("role, workspace_id, workspaces!inner(id, name, governance_enabled, credits_total, credits_reset_on)")
      .eq("user_id", user.id)
      .eq("status", "active");

  let { data: rows, error } = await load();
  if (error) throw new Error(`Couldn't load your workspaces: ${error.message}`);
  if (!rows || rows.length === 0) {
    // Email sign-up without the callback, or a first visit: set up their own Acme Ops now.
    await ensureWorkspace(createAdminDb(), user);
    ({ data: rows, error } = await load());
    if (error || !rows?.length) throw new Error(`Couldn't load your workspace: ${error?.message ?? "none found"}`);
  }

  const { data: owners } = await db
    .from("members")
    .select("workspace_id, user_id, display_name")
    .in("workspace_id", rows.map((r) => r.workspace_id))
    .eq("role", "owner")
    .eq("status", "active");
  const memberships: Membership[] = rows.map((r) => {
    const owner = owners?.find((o) => o.workspace_id === r.workspace_id);
    const ownerName = owner?.user_id === user.id ? null : owner?.display_name?.split(" ")[0];
    return {
      workspaceId: r.workspace_id,
      workspaceName: r.workspaces.name,
      role: r.role as Role,
      label: ownerName ? `${ownerName}'s ${r.workspaces.name}` : `Your ${r.workspaces.name}`,
    };
  });
  const chosen = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const current = pickWorkspace(memberships, chosen)!;
  const ws = rows.find((r) => r.workspace_id === current.workspaceId)!.workspaces;

  return {
    user,
    name: displayNameFor(user),
    workspace: {
      id: ws.id,
      name: ws.name,
      governanceEnabled: ws.governance_enabled,
      creditsTotal: Number(ws.credits_total),
      creditsResetOn: ws.credits_reset_on,
    },
    role: current.role,
    memberships,
  };
});
