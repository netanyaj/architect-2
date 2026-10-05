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

/** The seeded project keeps its bespoke sample app; every other plan gets the generic shell. */
export function usesMeetingPrepSample(name: string): boolean {
  return name.trim().toLowerCase() === "meeting prep";
}

/** The generic shell's state for a part: what the preview shows for it. */
function shellState(status: string): "works" | "sample" | "building" | "waiting" {
  if (status === "built") return "works";
  if (status === "sample_data" || status === "needs_connection") return "sample";
  if (status === "building" || status === "failed" || status === "paused") return "building";
  return "waiting";
}

/** base64url of UTF-8 JSON, for the shell's ?d= (works in the browser and on the server). */
function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function previewState(parts: PreviewPart[], connected: string[], opts: { name?: string } = {}) {
  const problems: Problem[] = parts
    .filter((p) => p.status === "failed" || p.status === "paused")
    .map((p) => ({ key: p.key, title: p.title, text: p.statusDetail ?? "A check failed." }));

  // Generic shell (every plan except the seeded Meeting Prep): the project's name and its parts as sections.
  if (opts.name !== undefined && !usesMeetingPrepSample(opts.name)) {
    const shown = parts.filter((p) => p.status !== "dropped" && p.status !== "deferred");
    const d = encode({ name: opts.name, parts: shown.map((p) => ({ k: p.key, t: p.title, g: p.grp, s: shellState(p.status) })) });
    const works = shown.filter((p) => SHOWS.has(p.status));
    return {
      kind: "shell" as const,
      reveal: works.map((p) => p.key),
      sample: works.filter((p) => p.status !== "built").map((p) => p.key),
      problems,
      src: `/preview/app/index.html?d=${d}`,
      highlight: (p: Pick<PreviewPart, "key">) => p.key,
    };
  }

  const reveal = new Set<PreviewSection>();
  const sample = new Set<PreviewSection>();
  for (const p of parts) {
    const s = sectionFor(p);
    if (!s || !SHOWS.has(p.status)) continue;
    reveal.add(s);
    if (p.status !== "built") sample.add(s);
  }
  const query = new URLSearchParams({ reveal: [...reveal].join(","), sample: [...sample].join(","), connected: connected.join(",") });
  return {
    kind: "meeting-prep" as const,
    reveal: [...reveal] as string[],
    sample: [...sample] as string[],
    problems,
    src: `/preview/meeting-prep/index.html?${query}`,
    highlight: (p: Pick<PreviewPart, "grp" | "title" | "provider">) => sectionFor(p),
  };
}
