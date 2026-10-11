/**
 * Plans and billing, simulated: Free, Starter, Pro and Custom (Enterprise) per workspace, mirroring today's Architect.
 * No payment is taken. In the prototype a plan decides whether a live app can hide the "Built with Architect"
 * watermark; a top-up adds credits to the month's allowance. Shared by client and server; no I/O.
 */
export type WorkspacePlan = "free" | "starter" | "pro" | "enterprise";

export type PlanInfo = {
  id: WorkspacePlan;
  label: string;
  /** Per month, billed monthly / billed annually. */
  monthly: string;
  annual: string;
  saves?: string;
  credits: string;
  popular?: boolean;
  features: string[];
  soon: string[];
};

/**
 * The plans, as today's Architect has them (docs.lyzr.ai, Architect › Plans and credits, read 11 Oct 2026), plus
 * what 2.0 adds for Enterprise (governance, private cloud). Billing is simulated: no payment is taken.
 */
export const PLANS: PlanInfo[] = [
  { id: "free", label: "Free", monthly: "$0", annual: "$0", credits: "Free credits to start", features: ["Marketplace", "Deploy apps and agents", "Publish to the Marketplace"], soon: ["Custom agent branding", "Analytics dashboard"] },
  { id: "starter", label: "Starter", monthly: "$20 a month", annual: "$17 a month, billed yearly", saves: "Saves $40 a year", credits: "$20 of credits a month", features: ["Everything in Free", "No “Built with Architect” watermark", "Priority support"], soon: ["Custom agent branding", "Analytics dashboard"] },
  { id: "pro", label: "Pro", monthly: "$40 a month", annual: "$35 a month, billed yearly", saves: "Saves $60 a year", credits: "$40 of credits a month", popular: true, features: ["Everything in Free", "No “Built with Architect” watermark", "Priority support"], soon: ["Custom agent branding", "Analytics dashboard"] },
  {
    id: "enterprise",
    label: "Custom",
    monthly: "Let's talk",
    annual: "Let's talk",
    credits: "Credits on contract",
    features: ["Everything in Pro", "Support from Team Lyzr", "Governance: approvals, policies, permission rules, audit log", "Runs in Lyzr Cloud or your own AWS VPC"],
    soon: [],
  },
];

/** Credit top-ups (simulated: no payment is taken; the credits are added to this month's allowance). */
export const TOP_UPS = [
  { credits: 500, price: "$5" },
  { credits: 1000, price: "$10" },
  { credits: 2500, price: "$25" },
] as const;

export function planOf(v: unknown): WorkspacePlan {
  return PLANS.some((p) => p.id === v) ? (v as WorkspacePlan) : "free";
}

/** Paid plans can hide the badge on a live app. */
export function canHideBadge(plan: WorkspacePlan): boolean {
  return plan !== "free";
}

export const BADGE_FREE = "The Free plan always shows it. Starter and up can hide it, in Settings › Plan.";
