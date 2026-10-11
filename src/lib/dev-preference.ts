/**
 * "Open projects in Developer view", a personal setting: for imported repos only (the default), always, or never.
 * It decides where a project link from Home and Projects lands; ?dev=1 and ⋯ › Developer view work as before.
 */
export type OpenInDev = "repos" | "always" | "never";
export const OPEN_IN_DEV: { value: OpenInDev; label: string }[] = [
  { value: "repos", label: "Imported repos" },
  { value: "always", label: "Always" },
  { value: "never", label: "Never" },
];

export function openInDevOf(v: unknown): OpenInDev {
  return v === "always" || v === "never" ? v : "repos";
}

/** Where a project link goes for this person. Viewers never open in Developer view (they can't edit code). */
export function projectHref(id: string, opts: { repo: boolean; pref: OpenInDev; canBuild: boolean }): string {
  const dev = opts.canBuild && (opts.pref === "always" || (opts.pref === "repos" && opts.repo));
  return dev ? `/p/${id}?dev=1` : `/p/${id}`;
}
