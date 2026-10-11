import { describe, expect, it, vi } from "vitest";

/* MCP Test connection guards (M6): HTTPS only, no private or local addresses, even after DNS; plain-word errors. */

vi.mock("server-only", () => ({}));
// "evil.example" resolves to a private address: the check must run on the resolved address.
vi.mock("node:dns", async (orig) => {
  const real = await orig<typeof import("node:dns")>();
  return {
    ...real,
    lookup: (host: string, opts: unknown, cb: (e: unknown, a: unknown) => void) => {
      if (host === "evil.example") return cb(null, [{ address: "10.0.0.5", family: 4 }]);
      if (host === "rebind.example") return cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "169.254.169.254", family: 4 }]);
      return (real.lookup as unknown as (h: string, o: unknown, c: unknown) => void)(host, opts, cb);
    },
  };
});

const { isBlockedAddress, parseAuthHeader, parseRpc, testMcpServer, urlProblem } = await import("@/server/mcp-client");
const { mcpAllowed, normalizeMcpUrl } = await import("@/lib/mcp-connections");

describe("MCP client guards", () => {
  it("blocks loopback, private, link-local, CGNAT, unique-local and mapped addresses; allows public ones", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isBlockedAddress(a)).toBe(true);
    for (const a of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) expect(isBlockedAddress(a)).toBe(false);
  });

  it("only takes HTTPS URLs to public hosts, without credentials", () => {
    expect(urlProblem("http://mcp.example.com")).toBe("The URL has to start with https://.");
    expect(urlProblem("https://localhost:3000/mcp")).toMatch(/private or local/);
    expect(urlProblem("https://127.0.0.1/mcp")).toMatch(/private or local/);
    expect(urlProblem("https://[::1]/mcp")).toMatch(/private or local/);
    expect(urlProblem("https://user:pw@mcp.example.com")).toMatch(/auth header/);
    expect(urlProblem("not a url")).toMatch(/full URL/);
    expect(urlProblem("https://mcp.example.com/mcp")).toBeNull();
  });

  it("refuses a host that resolves to a private address, or to any private address among several", async () => {
    expect(await testMcpServer("https://evil.example/mcp", null)).toEqual({ ok: false, error: "That address is private or local, so Architect won't call it." });
    expect(await testMcpServer("https://rebind.example/mcp", null)).toEqual({ ok: false, error: "That address is private or local, so Architect won't call it." });
  });

  it("reads auth headers and JSON-RPC answers, plain or streamed", () => {
    expect(parseAuthHeader("Authorization: Bearer abc")).toEqual(["Authorization", "Bearer abc"]);
    expect(parseAuthHeader("X-Api-Key: 123")).toEqual(["X-Api-Key", "123"]);
    expect(parseAuthHeader("abc123")).toEqual(["Authorization", "abc123"]);
    expect(parseAuthHeader("  ")).toBeNull();
    expect(parseRpc('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', "application/json")).toMatchObject({ result: { tools: [] } });
    expect(parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"search"}]}}\n\n', "text/event-stream")).toMatchObject({ result: { tools: [{ name: "search" }] } });
    expect(parseRpc("<html>", "text/html")).toBeNull();
  });

  it("matches the allowed list by URL, ignoring case and a trailing slash", () => {
    expect(normalizeMcpUrl("https://MCP.Example.com/mcp/")).toBe("https://mcp.example.com/mcp");
    expect(mcpAllowed("https://mcp.example.com/mcp/", [{ name: "Docs", url: "https://MCP.example.com/mcp" }])).toBe(true);
    expect(mcpAllowed("https://other.example.com/mcp", [{ name: "Docs", url: "https://mcp.example.com/mcp" }])).toBe(false);
  });
});
