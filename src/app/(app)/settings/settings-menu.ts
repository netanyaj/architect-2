/** Settings pages (M6): one address each, grouped as on GitHub's and Vercel's settings. Plain /settings is General. */
export type SettingsPage = { href: string; label: string };
export type SettingsGroup = { label: string; pages: SettingsPage[] };

export function settingsMenu({ demo }: { demo: boolean }): SettingsGroup[] {
  return [
    {
      label: "Workspace",
      pages: [
        { href: "/settings", label: "General" },
        { href: "/settings/members", label: "Members" },
        { href: "/settings/budgets", label: "Budgets" },
        { href: "/settings/governance", label: "Governance" },
        { href: "/settings/github", label: "GitHub" },
        ...(demo ? [{ href: "/settings/demo", label: "Demo data" }] : []),
      ],
    },
    {
      label: "You",
      pages: [
        { href: "/settings/appearance", label: "Appearance" },
        { href: "/settings/account", label: "Account" },
      ],
    },
  ];
}
