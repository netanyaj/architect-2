/**
 * Agent schedules (round 7): when an app's first agent runs on the clock, for example "Weekdays at 8:00, your time
 * zone". Simulated: nothing runs on a timer in this prototype; real schedules would run in the cell's orchestrator.
 * Stored as JSON text in `agents.schedule` on the agent the trigger starts. Shared by client and server; no I/O.
 */

export const SCHEDULE_DAYS = ["daily", "weekdays", "mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type ScheduleDays = (typeof SCHEDULE_DAYS)[number];

/** `tz` is an IANA time zone ("Europe/London"); empty means the time zone of whoever is looking. */
export type Schedule = { days: ScheduleDays; time: string; tz: string };

export const DAY_WORDS: Record<ScheduleDays, string> = {
  daily: "Every day",
  weekdays: "Weekdays",
  mon: "Mondays",
  tue: "Tuesdays",
  wed: "Wednesdays",
  thu: "Thursdays",
  fri: "Fridays",
  sat: "Saturdays",
  sun: "Sundays",
};

export const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** A time zone the platform knows. */
export function validTimeZone(tz: string): boolean {
  if (!tz) return true;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "08:00" → "8:00". */
const shortTime = (time: string) => time.replace(/^0(\d)/, "$1");

/** "London time" from "Europe/London"; "UTC" stays as it is. */
export function zoneWords(tz: string): string {
  if (tz === "UTC" || tz === "Etc/UTC") return "UTC";
  return `${(tz.split("/").pop() ?? tz).replace(/_/g, " ")} time`;
}

/** "Weekdays at 8:00, your time zone" (or "…, London time" when it isn't the viewer's). */
export function scheduleWords(s: Schedule, viewerTz?: string): string {
  const zone = !s.tz || s.tz === viewerTz ? "your time zone" : zoneWords(s.tz);
  return `${DAY_WORDS[s.days]} at ${shortTime(s.time)}, ${zone}`;
}

/** What `agents.schedule` holds: a schedule, "off" (starts on its trigger, chosen on purpose), or nothing yet. */
export function parseSchedule(text: string | null | undefined): Schedule | "off" | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<Schedule> & { off?: boolean };
    if (v.off) return "off";
    if (v.days && (SCHEDULE_DAYS as readonly string[]).includes(v.days) && typeof v.time === "string" && TIME_RE.test(v.time)) {
      return { days: v.days, time: padTime(v.time), tz: typeof v.tz === "string" && validTimeZone(v.tz) ? v.tz : "" };
    }
  } catch {
    // Not JSON: an older free-text value. Read it as words.
    return scheduleFromText(text);
  }
  return null;
}

export function storeSchedule(s: Schedule | null): string {
  return JSON.stringify(s ? { days: s.days, time: s.time, tz: s.tz } : { off: true });
}

const WEEKDAY_NAMES: [RegExp, ScheduleDays][] = [
  [/\bmondays?\b/i, "mon"],
  [/\btuesdays?\b/i, "tue"],
  [/\bwednesdays?\b/i, "wed"],
  [/\bthursdays?\b/i, "thu"],
  [/\bfridays?\b/i, "fri"],
  [/\bsaturdays?\b/i, "sat"],
  [/\bsundays?\b/i, "sun"],
];

/**
 * A schedule read from a plan's words ("Scoring runs once every weekday at 8:00"), for a plan whose schedule part
 * says when; null when the words don't name a schedule.
 */
export function scheduleFromText(text: string): Schedule | null {
  const t = text.toLowerCase();
  let days: ScheduleDays | null = null;
  if (/\bweekdays?\b|\bmonday to friday\b|\bworking days?\b/.test(t)) days = "weekdays";
  else if (/\bweekly\b|\bevery week\b/.test(t)) days = WEEKDAY_NAMES.find(([re]) => re.test(t))?.[1] ?? "mon";
  else days = WEEKDAY_NAMES.find(([re]) => re.test(t))?.[1] ?? (/\bdaily\b|\bevery (day|morning|evening)\b|\beach (day|morning)\b|\bschedule\b/.test(t) ? "daily" : null);
  if (!days) return null;
  const at = t.match(/\bat (\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let time = /\bevening\b/.test(t) ? "18:00" : /\bmorning\b/.test(t) ? "08:00" : "09:00";
  if (at) {
    let h = Number(at[1]);
    if (at[3] === "pm" && h < 12) h += 12;
    if (at[3] === "am" && h === 12) h = 0;
    if (h <= 23) time = `${String(h).padStart(2, "0")}:${at[2] ?? "00"}`;
  }
  return { days, time, tz: "" };
}

/** Same schedule? (null and undefined both mean none). */
export function sameSchedule(a: Schedule | null | undefined, b: Schedule | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.days === b.days && shortTime(a.time) === shortTime(b.time) && a.tz === b.tz;
}

/** "8:00" → "08:00", as a time input wants it. */
export const padTime = (time: string) => (/^\d:/.test(time) ? `0${time}` : time);

/** The time zone this browser is in ("" on the server). */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/** Time zones the editor offers besides the viewer's own. */
export const COMMON_ZONES = ["UTC", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Kolkata", "Asia/Singapore", "Australia/Sydney"];
