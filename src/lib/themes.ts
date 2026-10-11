/**
 * Look and feel (screen 5): theme presets for the app being built, applied to its preview. They style the person's
 * app, not Architect, so they aren't bound by Architect's own colour rules. Shared; no I/O.
 */
export type ThemeId = "soft" | "ocean" | "forest" | "sunset" | "graphite" | "editorial";
export type ThemeVars = { bg: string; ink: string; ink2: string; line: string; sel: string; accent: string; font: string; radius: string };

export const THEMES: { id: ThemeId; label: string; about: string; vars: ThemeVars }[] = [
  { id: "soft", label: "Soft Tray", about: "Quiet greys, the default", vars: { bg: "#ffffff", ink: "#16181d", ink2: "#5b616e", line: "#e4e6ea", sel: "#eef0f3", accent: "#16181d", font: 'system-ui, -apple-system, "Segoe UI", sans-serif', radius: "12px" } },
  { id: "ocean", label: "Ocean", about: "Calm blues", vars: { bg: "#f5f9fc", ink: "#0f2a3d", ink2: "#4a6478", line: "#c9dceb", sel: "#dbeaf5", accent: "#1565a8", font: 'system-ui, -apple-system, "Segoe UI", sans-serif', radius: "14px" } },
  { id: "forest", label: "Forest", about: "Greens, soft corners", vars: { bg: "#f6f8f4", ink: "#1f2d1c", ink2: "#56664f", line: "#d3ddca", sel: "#e1ead8", accent: "#2f6b2f", font: 'system-ui, -apple-system, "Segoe UI", sans-serif', radius: "16px" } },
  { id: "sunset", label: "Sunset", about: "Warm and friendly", vars: { bg: "#fff8f3", ink: "#3a1f12", ink2: "#7a5443", line: "#f2d9c8", sel: "#fde3d2", accent: "#c2410c", font: 'system-ui, -apple-system, "Segoe UI", sans-serif', radius: "18px" } },
  { id: "graphite", label: "Graphite", about: "Dark, high contrast", vars: { bg: "#15171b", ink: "#eceef2", ink2: "#a3a9b5", line: "#2f343c", sel: "#262a31", accent: "#8ab4ff", font: 'system-ui, -apple-system, "Segoe UI", sans-serif', radius: "10px" } },
  { id: "editorial", label: "Editorial", about: "Serif type, square corners", vars: { bg: "#fffdf8", ink: "#1c1917", ink2: "#57534e", line: "#e7e0d2", sel: "#f1ece2", accent: "#7c2d12", font: 'Georgia, "Times New Roman", serif', radius: "4px" } },
];

export function themeOf(id: unknown): (typeof THEMES)[number] {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/**
 * The preview's Dark view (M5.8): each preset's dark counterpart. Graphite is dark already. Used only when the app's
 * plan has a dark theme; otherwise the Dark view says so and offers to add one.
 */
const DARK: Record<ThemeId, Omit<ThemeVars, "font" | "radius">> = {
  soft: { bg: "#15171b", ink: "#eceef2", ink2: "#a3a9b5", line: "#2f343c", sel: "#262a31", accent: "#eceef2" },
  ocean: { bg: "#0d1b26", ink: "#e3eef7", ink2: "#93acc0", line: "#23394a", sel: "#17293a", accent: "#6cb4f0" },
  forest: { bg: "#121a12", ink: "#e4ece0", ink2: "#9db097", line: "#2a3a29", sel: "#1c281b", accent: "#7fc27f" },
  sunset: { bg: "#1f1410", ink: "#fbe9de", ink2: "#c9a593", line: "#3d2a20", sel: "#2c1d16", accent: "#fb8c4c" },
  graphite: { bg: "#15171b", ink: "#eceef2", ink2: "#a3a9b5", line: "#2f343c", sel: "#262a31", accent: "#8ab4ff" },
  editorial: { bg: "#1a1816", ink: "#f1ece4", ink2: "#b2aba0", line: "#37322b", sel: "#26221d", accent: "#e3a27a" },
};

export type PreviewScheme = "light" | "dark";

/** The variables the preview gets for a scheme: the preset itself, or its dark counterpart. */
export function previewVars(id: ThemeId, scheme: PreviewScheme): ThemeVars {
  const t = themeOf(id);
  return scheme === "dark" ? { ...t.vars, ...DARK[t.id] } : t.vars;
}

/** The part that adds a dark theme, when "Add to plan" makes the change card. */
export const DARK_THEME_PART = {
  key: "dark-theme",
  title: "Dark theme",
  description: "A dark colour scheme that follows the device's setting, with a switch to change it.",
  proved_when: "With the device set to dark, every screen shows light text on a dark background and passes a 4.5:1 contrast check.",
};

/** Whether the app has a dark theme: a dark-only preset (Graphite), or a part in the plan that adds one. */
export function hasDarkTheme(look: ThemeId, parts: { key: string; title: string; description?: string | null; status?: string }[]): boolean {
  if (look === "graphite") return true;
  return parts.some((p) => p.status !== "dropped" && p.status !== "deferred" && (p.key === DARK_THEME_PART.key || /\bdark (theme|mode)\b/i.test(`${p.title} ${p.description ?? ""}`)));
}
