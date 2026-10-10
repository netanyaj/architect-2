/**
 * API key connections (BL-9), simulated: a service the app calls with a key rather than by signing in (OAuth).
 * Architect records only that the key is set, by whom and when; the value is checked and thrown away. Shared by
 * client and server; no I/O.
 */

/** "Clearbit" → "clearbit", "Open Weather" → "open_weather": the id parts, policies and keys use. */
export function apiKeyServiceId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Why a key can't be saved, or null. */
export function apiKeyProblem(name: string, value: string): string | null {
  const n = name.trim();
  if (n.length < 2 || n.length > 40 || !apiKeyServiceId(n)) return "Name the service in 2 to 40 characters, like Clearbit.";
  if (!value.trim()) return "Paste the key first.";
  if (value.length > 4096) return "That key is longer than 4,096 characters.";
  return null;
}

/** The key name a part calling this service is given: "clearbit" → "CLEARBIT_API_KEY". */
export function apiKeyEnvName(serviceId: string): string {
  return `${serviceId.toUpperCase()}_API_KEY`;
}
