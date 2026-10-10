/**
 * Plans and billing, simulated: Free, Starter, Pro and Enterprise per workspace. No payment is taken; the plan only
 * decides whether a live app can hide the "Built with Architect" badge. Shared by client and server; no I/O.
 */
export type WorkspacePlan = "free" | "starter" | "pro" | "enterprise";

export const PLANS: { id: WorkspacePlan; label: string; price: string; credits: string; badge: string }[] = [
  { id: "free", label: "Free", price: "$0", credits: "200 credits a month", badge: "Live apps show “Built with Architect”" },
  { id: "starter", label: "Starter", price: "$20 a month", credits: "1,000 credits a month", badge: "Hide “Built with Architect”" },
  { id: "pro", label: "Pro", price: "$50 a seat a month", credits: "2,000 credits a month, shared", badge: "Hide “Built with Architect”" },
  { id: "enterprise", label: "Enterprise", price: "Talk to us", credits: "Credits on contract", badge: "Hide “Built with Architect”" },
];

export function planOf(v: unknown): WorkspacePlan {
  return PLANS.some((p) => p.id === v) ? (v as WorkspacePlan) : "free";
}

/** Paid plans can hide the badge on a live app. */
export function canHideBadge(plan: WorkspacePlan): boolean {
  return plan !== "free";
}

export const BADGE_FREE = "The Free plan always shows it. Starter and up can hide it, in Settings › Plan.";
