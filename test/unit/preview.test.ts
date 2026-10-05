import { describe, expect, it } from "vitest";
import { previewState, sectionFor, usesMeetingPrepSample } from "@/lib/sim/preview";

const part = (key: string, grp: string, title: string, status: string, provider: string | null = null) => ({ key, grp, title, provider, status, statusDetail: status === "paused" ? "Stopped after 3 fixes to protect your credits" : null });

describe("preview", () => {
  it("matches parts to the app's sections", () => {
    expect(sectionFor({ grp: "integrations", title: "Last email thread per attendee", provider: "gmail" })).toBe("email");
    expect(sectionFor({ grp: "agents", title: "Agenda PDF summariser", provider: null })).toBe("agenda");
    expect(sectionFor({ grp: "agents", title: "Talking points generator", provider: null })).toBe("talking-points");
    expect(sectionFor({ grp: "integrations", title: "Calendar sync", provider: "google_calendar" })).toBe("connections");
    expect(sectionFor({ grp: "quality", title: "Schedule", provider: null })).toBeNull();
  });

  it("reveals what works, marks what uses sample data, and lists problems", () => {
    const s = previewState(
      [
        part("mail", "integrations", "Last email thread", "needs_connection", "gmail"),
        part("agenda", "agents", "Agenda summariser", "built"),
        part("points", "agents", "Talking points", "paused"),
        part("cal", "integrations", "Calendar sync", "building", "google_calendar"),
      ],
      ["google_calendar"],
    );
    expect(s.reveal).toEqual(["email", "agenda"]);
    expect(s.sample).toEqual(["email"]);
    expect(s.problems).toEqual([{ key: "points", title: "Talking points", text: "Stopped after 3 fixes to protect your credits" }]);
    expect(s.src).toBe("/preview/meeting-prep/index.html?reveal=email%2Cagenda&sample=email&connected=google_calendar");
  });
});

describe("the generic shell", () => {
  it("every plan but the seeded Meeting Prep gets a shell of its own name and parts", () => {
    expect(usesMeetingPrepSample("Meeting Prep")).toBe(true);
    expect(usesMeetingPrepSample("Lead scorer")).toBe(false);
    const s = previewState(
      [part("leads", "integrations", "New HubSpot leads", "built", "hubspot"), part("score", "agents", "Score from 0 to 100", "building"), part("old", "features", "Gone", "dropped")],
      [],
      { name: "Lead scorer" },
    );
    expect(s.kind).toBe("shell");
    expect(s.reveal).toEqual(["leads"]);
    const d = new URL(s.src, "http://x").searchParams.get("d")!;
    const decoded = JSON.parse(Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    expect(decoded).toEqual({ name: "Lead scorer", parts: [{ k: "leads", t: "New HubSpot leads", g: "integrations", s: "works" }, { k: "score", t: "Score from 0 to 100", g: "agents", s: "building" }] });
    expect(s.highlight({ key: "score", grp: "agents", title: "Score", provider: null })).toBe("score");
  });
  it("the seeded project keeps the Meeting Prep sample", () => {
    expect(previewState([part("mail", "integrations", "Last email thread", "built", "gmail")], [], { name: "Meeting Prep" }).src).toMatch(/^\/preview\/meeting-prep\//);
  });
});
