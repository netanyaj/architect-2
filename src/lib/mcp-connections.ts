import type { McpServer } from "./policies";

/* MCP servers in Connections (M6): shared by the server and the browser. */

/** https://Mcp.Example.com/mcp/ and https://mcp.example.com/mcp are the same server. */
export function normalizeMcpUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim();
  }
}

/** With governance on, a server can be added only if it's on the allowed list (by URL). */
export function mcpAllowed(url: string, allowed: McpServer[]): boolean {
  const n = normalizeMcpUrl(url);
  return allowed.some((m) => normalizeMcpUrl(m.url) === n);
}

/** How an agent lists a connected server among its tools. */
export const mcpToolLabel = (name: string) => `MCP: ${name}`;

export type McpConnection = { id: string; name: string; url: string; tools: string[]; checkedAt: string | null; error: string | null; connected: boolean };
