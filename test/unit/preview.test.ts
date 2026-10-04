import { describe, expect, it } from "vitest";
import { previewState, sectionFor } from "@/lib/sim/preview";

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
