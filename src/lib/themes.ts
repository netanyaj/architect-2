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
