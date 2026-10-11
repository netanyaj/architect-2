import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAdminDb } from "./db";

/**
 * First-party product events (M5.10), for us only: did reviewers use the features? Insert-only with the service role;
 * nobody reads them through the API (docs/analytics.sql reads them in Supabase). Never prompt text, names or emails.
 */
export type AnalyticsEvent = "plan_written" | "build_started" | "blocker_resolved" | "launch" | "view_as_role" | "tour_step" | "demo_reset" | "demo_started";

export function isDemoUser(user: Pick<User, "is_anonymous"> | null | undefined): boolean {
  return Boolean(user?.is_anonymous);
}

/** Records one event. Never throws: analytics must not break the action it describes. */
export async function track(
  event: AnalyticsEvent,
  who: { user: Pick<User, "id" | "is_anonymous">; workspaceId?: string | null; projectId?: string | null; detail?: string | null },
): Promise<void> {
  try {
    await createAdminDb()
      .from("analytics_events")
      .insert({
        event,
        user_id: who.user.id,
        workspace_id: who.workspaceId ?? null,
        project_id: who.projectId ?? null,
        is_demo: isDemoUser(who.user),
        detail: who.detail ? who.detail.slice(0, 40) : null,
      });
  } catch {
    // Dropped: an event is never worth a failed action.
  }
}
