/**
 * A daily limit on writing plans, per person (M5.5): the prototype runs on a free Gemini quota shared by everyone, so
 * one person can't use it up. Counted from the plans they started since midnight UTC, across workspaces. Shared.
 */
export const DEFAULT_PLAN_DAILY_LIMIT = 20;

export function planDailyLimit(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_PLAN_DAILY_LIMIT;
}

export function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function planLimitMessage(limit: number, now: Date): string {
  const next = new Date(startOfDayUtc(now).getTime() + 24 * 3600_000);
  const hours = Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 3600_000));
  return `You've written ${limit} plans today, the most for one person while Architect runs on a free model quota. You can write more after midnight UTC, in about ${hours} ${hours === 1 ? "hour" : "hours"}. Your plans are all kept, and you can still change them in chat.`;
}
