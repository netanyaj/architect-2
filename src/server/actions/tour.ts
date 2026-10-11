"use server";

import { revalidatePath } from "next/cache";
import { TOUR_STEPS, type TourStep } from "@/lib/tour";
import { track } from "../analytics";
import { createAdminDb } from "../db";
import { getAppContext } from "../workspace";
import type { ActionResult } from "./members";

/** Hide the tour card (saved per person). */
export async function dismissTour(): Promise<ActionResult> {
  const ctx = await getAppContext();
  const admin = createAdminDb();
  const { data } = await admin.from("user_preferences").select("tour").eq("user_id", ctx.user.id).maybeSingle();
  const tour = { ...((data?.tour as object | null) ?? {}), dismissed: true };
  const { error } = await admin.from("user_preferences").upsert({ user_id: ctx.user.id, tour, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: "The tour couldn't be hidden. Try again." };
  revalidatePath("/home");
  return { ok: true };
}

/** A tour step's link was followed (analytics only: the step is done when the person does it). */
export async function openTourStep(step: TourStep): Promise<void> {
  if (!TOUR_STEPS.includes(step)) return;
  const ctx = await getAppContext();
  await track("tour_step", { user: ctx.user, workspaceId: ctx.workspace.id, detail: step });
}
