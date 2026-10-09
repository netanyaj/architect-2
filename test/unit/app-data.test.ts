import { describe, expect, it } from "vitest";
import { appTables, appUsers, filterRows, toCsv } from "@/lib/app-data";

const parts = [
  { key: "new-tickets-read", title: "New tickets read", grp: "integrations", status: "built" },
  { key: "vendor-list", title: "Vendor list table", grp: "data", status: "sample_data" },
  { key: "slack", title: "Slack alert to the team", grp: "integrations", status: "built" },
  { key: "later", title: "Customer table", grp: "data", status: "agreed" },
];

describe("appTables", () => {
  it("Meeting Prep has screen 13's tables; other projects get tables from their built parts", () => {
    expect(appTables({ projectId: "p", projectName: "Meeting Prep", parts: [], version: "test" }).map((t) => [t.name, t.total, t.sample])).toEqual([
      ["Briefs", 128, false],
      ["Meetings", 131, false],
      ["Attendees", 46, false],
      ["Email threads", 212, false],
      ["Meeting notes", 12, true],
    ]);
    const tables = appTables({ projectId: "p", projectName: "ticket-triage", parts, version: "test" });
    expect(tables.map((t) => [t.name, t.sample])).toEqual([
      ["New tickets", false],
      ["Vendor list", true],
    ]);
    expect(tables[0].columns.map((c) => c.label)).toEqual(["Subject", "Customer", "Urgency", "Team", "Received"]);
    expect(tables[0].rows).toHaveLength(tables[0].total);
  });

  it("is the same every time for a project and version, and each version has its own rows", () => {
    const a = appTables({ projectId: "p1", projectName: "x", parts, version: "test" });
    expect(appTables({ projectId: "p1", projectName: "x", parts, version: "test" })).toEqual(a);
    const live = appTables({ projectId: "p1", projectName: "x", parts, version: "live" });
    expect(live[0].total).toBeGreaterThan(a[0].total);
    expect(live[0].rows[0]).not.toEqual(a[0].rows[0]);
  });

  it("nothing built, nothing stored", () => {
    expect(appTables({ projectId: "p", projectName: "x", parts: parts.map((p) => ({ ...p, status: "agreed" })), version: "test" })).toEqual([]);
  });
});

describe("appUsers, filterRows, toCsv", () => {
  it("the sign-ins per version use the sign-in method", () => {
    const users = appUsers({ projectId: "p", version: "test", method: "email", domain: "acme.com" });
    expect(users).toHaveLength(3);
    expect(users.every((u) => u.via === "Email" && u.email.endsWith("@acme.com"))).toBe(true);
    expect(appUsers({ projectId: "p", version: "live", method: "sso", domain: "acme.com" })).toHaveLength(14);
  });

  it("every word of the filter must appear in the row", () => {
    const rows = [{ a: "Hiring sync", b: "Sam" }, { a: "Board prep", b: "Sam" }];
    expect(filterRows(rows, "sam hiring")).toEqual([rows[0]]);
    expect(filterRows(rows, "  ")).toEqual(rows);
  });

  it("CSV quotes commas, quotes and new lines", () => {
    expect(toCsv([{ key: "a", label: "Meeting" }, { key: "b", label: "Attendees" }], [{ a: "Board prep", b: 'Dana, "DW"\nWhitfield' }])).toBe('Meeting,Attendees\r\nBoard prep,"Dana, ""DW""\nWhitfield"\r\n');
  });
});
