/**
 * The Data tab (screen 13), simulated: what the app stores, per version, seeded from the project's own parts so
 * every project has believable tables. The same project, version and table always give the same rows. Shared; no I/O.
 */
import { usesMeetingPrepSample } from "./sim/preview";

export type DataVersion = "test" | "team" | "live";
export const VERSION_LABEL: Record<DataVersion, string> = { test: "Test version data", team: "Team version data", live: "Live data" };

export type Column = { key: string; label: string; type: "text" | "people" | "status" | "time" | "number" | "email"; about: string };
export type DataTable = { key: string; name: string; columns: Column[]; rows: Record<string, string>[]; total: number; sample: boolean };
export type SignInMethod = "google" | "email" | "sso";
export const SIGN_IN_LABEL: Record<SignInMethod, string> = { google: "Google sign-in", email: "Email and password", sso: "Your company's single sign-on" };

type Part = { key: string; title: string; grp: string; status: string };

function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)];

const PEOPLE = ["Dana Whitfield", "Marco Reyes", "Lena Brooks", "Sam Ortiz", "Morgan Lee", "Maya Nair", "Tom Hale", "Ana Lima", "Jordan Park", "Riley Chen", "Noah Grant", "Ava Patel"];
const COMPANIES = ["Northwind", "Acme", "Brightline Logistics", "Globex", "Initech", "Umbrella Health", "Stark Supply", "Wayne Retail"];
const DAYS = ["Today", "Yesterday", "Mon", "Tue", "Wed", "Thu", "Fri"];
const time = (r: () => number) => `${pick(r, DAYS)} ${String(8 + Math.floor(r() * 10)).padStart(2, "0")}:${pick(r, ["00", "15", "30", "45"])}`;

/** Columns by what a table holds, read from its name. */
function columnsFor(name: string): Column[] {
  const n = name.toLowerCase();
  const c = (key: string, label: string, type: Column["type"], about: string): Column => ({ key, label, type, about });
  if (/ticket/.test(n)) return [c("subject", "Subject", "text", "The ticket's subject line"), c("customer", "Customer", "text", "Who raised it"), c("urgency", "Urgency", "text", "P1 to P3, set by the app"), c("team", "Team", "text", "The team it's routed to"), c("received", "Received", "time", "When it arrived")];
  if (/lead|score/.test(n)) return [c("company", "Company", "text", "The lead's company"), c("contact", "Contact", "people", "Who to talk to"), c("size", "Employees", "number", "Company size"), c("score", "Score", "number", "0 to 100, with a reason"), c("updated", "Scored", "time", "When it was last scored")];
  if (/meeting|calendar|brief|event/.test(n)) return [c("meeting", "Meeting", "text", "The calendar event"), c("attendees", "Attendees", "people", "Who's coming"), c("status", "Status", "status", "Sent, scheduled or failed"), c("sent", "Sent", "time", "When the brief went out")];
  if (/email|thread|message/.test(n)) return [c("from", "From", "people", "The sender"), c("subject", "Subject", "text", "The thread's subject"), c("messages", "Messages", "number", "Messages in the thread"), c("last", "Last message", "time", "When the last one arrived")];
  if (/vendor|renewal|invoice/.test(n)) return [c("vendor", "Vendor", "text", "Who it's with"), c("owner", "Owner", "people", "Who looks after it"), c("status", "Status", "status", "Due, handled or overdue"), c("due", "Due", "time", "When it renews")];
  return [c("name", "Name", "text", `One ${name.toLowerCase()} record`), c("owner", "Owner", "people", "Who it belongs to"), c("status", "Status", "status", "Where it's at"), c("updated", "Updated", "time", "Last change")];
}

function cell(r: () => number, col: Column, i: number): string {
  switch (col.key) {
    case "subject":
      return pick(r, ["Export failed again", "Refund not received", "SSO login broken", "Can't invite a teammate", "Slow dashboard", "Invoice is wrong", "Checkout is down"]);
    case "customer":
    case "company":
    case "vendor":
      return pick(r, COMPANIES);
    case "urgency":
      return pick(r, ["P1", "P2", "P2", "P3", "P3"]);
    case "team":
      return pick(r, ["Billing", "Identity", "Product"]);
    case "size":
      return String(20 + Math.floor(r() * 900));
    case "score":
      return String(Math.floor(r() * 100));
    case "messages":
      return String(1 + Math.floor(r() * 12));
    case "meeting":
      return pick(r, ["Q4 pipeline review", "Vendor renewal", "Hiring sync", "Weekly recap", "Board prep", "Design review", "Customer call"]);
    case "attendees":
      return `${pick(r, PEOPLE)}${r() > 0.5 ? `, ${pick(r, PEOPLE)}` : ""}`;
    case "status":
      return pick(r, col.about.startsWith("Sent") ? ["Sent", "Sent", "Scheduled", "Failed"] : col.about.startsWith("Due") ? ["Due", "Handled", "Handled", "Overdue"] : ["Done", "Done", "In progress", "Waiting"]);
    case "name":
      return `${pick(r, ["Record", "Item", "Entry"])} ${i + 1}`;
    default:
      return col.type === "people" ? pick(r, PEOPLE) : col.type === "time" ? time(r) : col.type === "number" ? String(Math.floor(r() * 100)) : pick(r, COMPANIES);
  }
}

/** How many rows each version holds: the test version has sample data; the team and live versions grow with use. */
const SCALE: Record<DataVersion, number> = { test: 1, team: 0.35, live: 2.4 };

function table(projectId: string, version: DataVersion, key: string, name: string, base: number, sample: boolean): DataTable {
  const columns = columnsFor(name);
  const total = Math.max(3, Math.round(base * SCALE[version]));
  const r = rng(`${projectId}:${version}:${key}`);
  const rows = Array.from({ length: total }, (_, i) => Object.fromEntries(columns.map((c) => [c.key, cell(r, c, i)])));
  return { key, name, columns, rows, total, sample };
}

const singular = (title: string) => title.replace(/\b(read|lookup|look-up|sync|table|summarised|summary)\b/gi, "").replace(/\s+/g, " ").trim();

/** The app's tables for one version: from its data parts and the services it reads (Meeting Prep: screen 13's). */
export function appTables(input: { projectId: string; projectName: string; parts: Part[]; version: DataVersion }): DataTable[] {
  const { projectId, version } = input;
  if (usesMeetingPrepSample(input.projectName)) {
    return [
      table(projectId, version, "briefs", "Briefs", 128, false),
      table(projectId, version, "meetings", "Meetings", 131, false),
      table(projectId, version, "attendees", "Attendees", 46, false),
      table(projectId, version, "email-threads", "Email threads", 212, false),
      table(projectId, version, "meeting-notes", "Meeting notes", 12, true),
    ];
  }
  const active = input.parts.filter((p) => !["dropped", "deferred"].includes(p.status));
  const built = (p: Part) => ["built", "sample_data", "needs_connection"].includes(p.status);
  const sources = active.filter((p) => p.grp === "data" || (p.grp === "integrations" && /read|new|incoming|lookup|events|thread/i.test(p.title)));
  const tables = sources.filter(built).map((p, i) => table(projectId, version, p.key, singular(p.title) || p.title, 24 + ((i * 37) % 90), p.status !== "built"));
  if (!tables.length && active.some(built)) tables.push(table(projectId, version, "records", input.projectName, 40, true));
  return tables;
}

/** The app's sign-ins for a version (the Users table). */
export function appUsers(input: { projectId: string; version: DataVersion; method: SignInMethod; domain: string }) {
  const r = rng(`${input.projectId}:${input.version}:users`);
  const count = input.version === "test" ? 3 : input.version === "team" ? 6 : 14;
  const via = input.method === "google" ? "Google" : input.method === "email" ? "Email" : "SSO";
  return Array.from({ length: count }, (_, i) => {
    const name = PEOPLE[(i + Math.floor(r() * 3)) % PEOPLE.length];
    return { name, email: `${name.split(" ")[0].toLowerCase()}@${input.domain}`, via, last: time(r), role: i === 0 ? "Owner" : "User" };
  });
}

/** CSV with quoting for commas, quotes and new lines (RFC 4180). */
export function toCsv(columns: { key: string; label: string }[], rows: Record<string, string>[]): string {
  const q = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [columns.map((c) => q(c.label)).join(","), ...rows.map((row) => columns.map((c) => q(row[c.key] ?? "")).join(","))].join("\r\n") + "\r\n";
}

/** Rows matching a filter: every word must appear somewhere in the row. */
export function filterRows(rows: Record<string, string>[], filter: string): Record<string, string>[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((row) => {
    const text = Object.values(row).join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
