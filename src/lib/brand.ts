/**
 * Soft Tray v4 brand layer (docs/product/23-brand-layer-v4.md): the deterministic bits behind the pictures.
 * Brand and art colours are for pictures only: never a button, badge, link, status or text next to a status.
 */

/** FNV-1a, 32-bit: the same id always gives the same picture, on the server and in the browser. */
export function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const ACCENTS = ["peony", "tangerine", "yolk", "lilac"] as const;
export type Accent = (typeof ACCENTS)[number];

/** One accent per project, from its id, so every project is recognisable without a label. */
export function accentFor(id: string): Accent {
  return ACCENTS[hash(`accent:${id}`) % ACCENTS.length];
}

export type MosaicTone = "moss" | "fern" | "mist";

/** A part's mosaic cell: moss when it works, fern while it's being built, mist when it's up next. */
export function toneFor(status: string): MosaicTone {
  if (status === "built" || status === "sample_data") return "moss";
  if (status === "building" || status === "failed" || status === "paused") return "fern";
  return "mist";
}

export const MOSAIC_ROWS = 4;
export const MOSAIC_MAX_COLUMNS = 8;

export type MosaicColumn = { height: number; tone: MosaicTone };
export type Mosaic = { columns: MosaicColumn[]; accent: { column: number; row: number; colour: Accent } };

/**
 * One column per plan part (dropped and deferred parts aren't drawn), up to 8; `crop` keeps the first few.
 * A column's height (1–4 cells) comes from the part's id, so the picture is the same on every render.
 * Exactly one cell takes the project's accent.
 */
export function mosaicFor(seed: string, parts: { id: string; status: string }[], crop = MOSAIC_MAX_COLUMNS): Mosaic {
  const shown = parts.filter((p) => p.status !== "dropped" && p.status !== "deferred");
  // No plan yet: a quiet row of unstarted columns, still unique to the project.
  const source = shown.length ? shown : Array.from({ length: 5 }, (_, i) => ({ id: `${seed}:${i}`, status: "proposed" }));
  const columns = source.slice(0, Math.min(crop, MOSAIC_MAX_COLUMNS)).map((p) => ({ height: 1 + (hash(p.id) % MOSAIC_ROWS), tone: toneFor(p.status) }));
  const cells = columns.flatMap((c, column) => Array.from({ length: c.height }, (_, row) => ({ column, row })));
  const at = cells[hash(`cell:${seed}`) % cells.length];
  return { columns, accent: { ...at, colour: accentFor(seed) } };
}

/** A template's picture: it's a working idea, so its columns are all finished. Size follows its typical cost. */
export function templateParts(id: string, credits = 120): { id: string; status: string }[] {
  const n = Math.max(3, Math.min(MOSAIC_MAX_COLUMNS, Math.round(credits / 25)));
  return Array.from({ length: n }, (_, i) => ({ id: `${id}:${i}`, status: "built" }));
}

/** An empty state's picture: a few finished and unstarted columns, in mist and moss, with one accent. */
export function emptyParts(seed: string): { id: string; status: string }[] {
  return Array.from({ length: 6 }, (_, i) => ({ id: `${seed}:${i}`, status: hash(`${seed}:tone:${i}`) % 3 === 0 ? "built" : "proposed" }));
}

export const AGENT_ROLES = ["planner", "extractor", "checker", "notifier", "router", "writer", "data analyst", "custom"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/** Keywords per role, checked in this order against the agent's name first, then its description. */
const ROLE_WORDS: [AgentRole, RegExp][] = [
  ["router", /\b(rout|triag|label|classif|sort|assign|urgency|categor|tag)/],
  ["checker", /\b(check|verif|validat|review|scor|qualif|complian|audit|guard|test)/],
  ["notifier", /\b(notif|alert|remind|ping|digest|announc)/],
  ["writer", /\b(writ|draft|repl|brief|summar|compos|recap|respon|copy)/],
  ["extractor", /\b(extract|pars|scrap|pull|research|find|look ?up|read|ocr|pdf|enrich|collect)/],
  ["data analyst", /\b(analy|report|metric|forecast|trend|dashboard|insight|data)/],
  ["planner", /\b(plan|schedul|coordinat|orchestrat|organi[sz]|decid|prioriti)/],
];

/** Each agent gets one role glyph from what it does; anything unrecognised is custom. */
export function agentRole(name: string, description = ""): AgentRole {
  for (const text of [name.toLowerCase(), description.toLowerCase()]) {
    for (const [role, re] of ROLE_WORDS) if (re.test(text)) return role;
  }
  return "custom";
}
