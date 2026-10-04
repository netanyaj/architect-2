/**
 * What the preview app shows (docs/SIMULATOR.md "Preview app"): the real parts are matched to the Meeting Prep
 * app's sections by group, service and keywords, so any plan gets a sensible preview.
 */
export type PreviewPart = { key: string; grp: string; title: string; provider: string | null; status: string; statusDetail: string | null };

export type PreviewSection = "email" | "agenda" | "talking-points" | "connections";

const SHOWS = new Set(["built", "sample_data", "needs_connection"]);

export function sectionFor(p: Pick<PreviewPart, "grp" | "title" | "provider">): PreviewSection | null {
  const text = p.title.toLowerCase();
  if (p.provider === "gmail" || /email|inbox|thread/.test(text)) return "email";
  if (p.grp === "agents" && /pdf|agenda|summar/.test(text)) return "agenda";
  if (p.grp === "agents") return "talking-points";
  if (p.grp === "integrations") return "connections";
  return null;
}

export type Problem = { key: string; title: string; text: string };

export function previewState(parts: PreviewPart[], connected: string[]) {
  const reveal = new Set<PreviewSection>();
  const sample = new Set<PreviewSection>();
  for (const p of parts) {
    const s = sectionFor(p);
    if (!s || !SHOWS.has(p.status)) continue;
    reveal.add(s);
    if (p.status !== "built") sample.add(s);
  }
  const problems: Problem[] = parts
    .filter((p) => p.status === "failed" || p.status === "paused")
    .map((p) => ({ key: p.key, title: p.title, text: p.statusDetail ?? "A check failed." }));
  const query = new URLSearchParams({ reveal: [...reveal].join(","), sample: [...sample].join(","), connected: connected.join(",") });
  return { reveal: [...reveal], sample: [...sample], problems, src: `/preview/meeting-prep/index.html?${query}` };
}
