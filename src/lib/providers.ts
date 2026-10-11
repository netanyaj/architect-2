/** Services a plan connects to, in plain words (Connections, the Plan panel, Launch). */
export const PROVIDERS: Record<string, { name: string; tool: string; what: string; account: string }> = {
  google_calendar: { name: "Google Calendar", tool: "Calendar", what: "Reads your meetings and who's coming.", account: "Google account" },
  gmail: { name: "Gmail", tool: "Gmail", what: "Reads email threads you choose. Never sends without asking.", account: "Google account" },
  slack: { name: "Slack", tool: "Slack", what: "Posts messages to channels and DMs.", account: "Slack workspace" },
  hubspot: { name: "HubSpot", tool: "HubSpot", what: "Reads leads, companies and deals.", account: "HubSpot account" },
  zendesk: { name: "Zendesk", tool: "Zendesk", what: "Reads tickets and drafts replies.", account: "Zendesk account" },
  github: { name: "GitHub", tool: "GitHub", what: "Reads the repos you pick.", account: "GitHub account" },
};

/** Services Architect connects by signing in (the list above); any other service connects with an API key (BL-9). */
export function isSignInService(provider: string | null | undefined): boolean {
  return Boolean(provider && PROVIDERS[provider]);
}

/** A key-service part after Action needed › Skip (M5.8): it keeps sample data and leaves Needs you. */
export const WAITING_FOR_KEY = "Waiting for a key";

/** "google_drive" → "Google Drive" for services we don't list. */
export function providerName(provider: string | null | undefined): string {
  if (!provider) return "the service";
  return PROVIDERS[provider]?.name ?? provider.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function providerAccount(provider: string | null | undefined): string {
  return (provider && PROVIDERS[provider]?.account) ?? `${providerName(provider)} account`;
}
