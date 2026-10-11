import "server-only";

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request } from "node:https";
import { isIP } from "node:net";

/*
 * Test connection for an MCP server (M6, PRD BL-9): a real MCP `initialize` then `tools/list` over streamable HTTP.
 * Guarded, because the URL comes from a person:
 * - HTTPS only; private, loopback, link-local, CGNAT and unique-local addresses are refused, checked on the address
 *   the socket actually connects to (a custom DNS lookup), so DNS rebinding can't slip one through;
 * - redirects are followed (up to 3) only to HTTPS URLs that pass the same check;
 * - 10 s for the whole test, and at most 1 MB read from any response.
 * Rate limits and the audit log are the caller's job (src/server/actions/mcp.ts).
 */

export const MCP_TIMEOUT_MS = 10_000;
export const MCP_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const PROTOCOL_VERSION = "2025-06-18";

export type McpTool = { name: string; description: string };
export type McpTestResult = { ok: true; tools: McpTool[]; serverName: string | null } | { ok: false; error: string };

export class McpRefused extends Error {}

/** True for addresses Architect must never call: loopback, private, link-local, CGNAT, unique-local, unspecified. */
export function isBlockedAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast, reserved, broadcast
    );
  }
  if (v === 6) {
    const s = address.toLowerCase();
    if (s === "::" || s === "::1") return true;
    // IPv4-mapped (::ffff:10.0.0.1): judge the IPv4 address.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isBlockedAddress(mapped[1]);
    return /^(fe[89ab]|fc|fd|ff)/.test(s); // link-local fe80::/10, unique-local fc00::/7, multicast
  }
  return true;
}

/** The URL people may add: HTTPS, a real host name or public address, no credentials in it. */
export function urlProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "Enter the server's full URL, like https://mcp.example.com/mcp.";
  }
  if (u.protocol !== "https:") return "The URL has to start with https://.";
  if (u.username || u.password) return "Put credentials in the auth header, not in the URL.";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "That address is private or local, so Architect won't call it.";
  if (isIP(host) && isBlockedAddress(host)) return "That address is private or local, so Architect won't call it.";
  return null;
}

/** "Authorization: Bearer x" or a bare value (sent as Authorization). */
export function parseAuthHeader(raw: string | null | undefined): [string, string] | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const m = /^([A-Za-z0-9-]{1,64}):\s*(.+)$/.exec(v);
  return m ? [m[1], m[2]] : ["Authorization", v];
}

/** The DNS lookup every request uses: it refuses blocked addresses on the address actually used. */
function guardedLookup(hostname: string, options: object, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (bad || !list.length) return callback(Object.assign(new McpRefused("blocked address"), { code: "EBLOCKED" }), "", 0);
    if ((options as { all?: boolean }).all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

type Res = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

function post(url: URL, body: unknown, headers: Record<string, string>, signal: AbortSignal): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        lookup: guardedLookup as never,
        signal,
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "Architect-MCP-check/1.0", ...headers },
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MCP_MAX_BYTES) {
            req.destroy(Object.assign(new McpRefused("too big"), { code: "ETOOBIG" }));
            return;
          }
          chunks.push(c);
          // A streamed answer (SSE) can stay open: stop once a full JSON-RPC message has arrived.
          if (String(res.headers["content-type"] ?? "").includes("text/event-stream") && /\n\n/.test(Buffer.concat(chunks).toString("utf8")) && /"(result|error)"/.test(Buffer.concat(chunks).toString("utf8"))) {
            res.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
          }
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

/** POST, following up to 3 redirects to HTTPS URLs that pass the same checks. */
async function postFollowing(url: URL, body: unknown, headers: Record<string, string>, signal: AbortSignal): Promise<Res> {
  let target = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await post(target, body, headers, signal);
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.location;
    if (typeof location !== "string") return res;
    const next = new URL(location, target);
    if (urlProblem(next.toString())) throw Object.assign(new McpRefused("redirect to a blocked address"), { code: "EBLOCKED" });
    target = next;
  }
  throw new McpRefused("too many redirects");
}

/** A JSON-RPC message from a plain JSON body or from the first SSE `data:` lines. */
export function parseRpc(body: string, contentType: string): { result?: unknown; error?: { message?: string } } | null {
  try {
    if (contentType.includes("text/event-stream")) {
      for (const block of body.split(/\n\n/)) {
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (!data) continue;
        const msg = JSON.parse(data) as { result?: unknown; error?: { message?: string } };
        if ("result" in msg || "error" in msg) return msg;
      }
      return null;
    }
    return JSON.parse(body) as { result?: unknown; error?: { message?: string } };
  } catch {
    return null;
  }
}

function plainError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code === "EBLOCKED") return "That address is private or local, so Architect won't call it.";
  if (code === "ETOOBIG") return "The server's answer was over 1 MB, so Architect stopped reading it.";
  if (err instanceof McpRefused && /redirects/.test(err.message)) return "The server redirected too many times.";
  if ((err as Error)?.name === "AbortError" || code === "ABORT_ERR") return "Server didn't answer within 10 seconds.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Server didn't answer: its address couldn't be found.";
  return "Server didn't answer.";
}

/** Initialize, then tools/list. Never throws: the result says what happened, in plain words. */
export async function testMcpServer(rawUrl: string, authHeader: string | null): Promise<McpTestResult> {
  const problem = urlProblem(rawUrl);
  if (problem) return { ok: false, error: problem };
  const url = new URL(rawUrl);
  const auth = parseAuthHeader(authHeader);
  const signal = AbortSignal.timeout(MCP_TIMEOUT_MS);
  const headers: Record<string, string> = auth ? { [auth[0]]: auth[1] } : {};
  try {
    const init = await postFollowing(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Architect", version: "2.0" } } }, headers, signal);
    if (init.status === 401 || init.status === 403) return { ok: false, error: "Needs a valid auth header." };
    if (init.status >= 400) return { ok: false, error: `That URL didn't answer as an MCP server (it said ${init.status}).${auth ? "" : " If it needs a key, add an auth header."}` };
    const initMsg = parseRpc(init.body, String(init.headers["content-type"] ?? ""));
    if (!initMsg || initMsg.error || !initMsg.result) return { ok: false, error: initMsg?.error?.message ? `The server refused: ${initMsg.error.message.slice(0, 120)}` : "That URL didn't answer as an MCP server." };
    const serverName = ((initMsg.result as { serverInfo?: { name?: unknown } }).serverInfo?.name as string | undefined) ?? null;
    const session = init.headers["mcp-session-id"];
    const withSession = { ...headers, ...(typeof session === "string" ? { "mcp-session-id": session } : {}), "mcp-protocol-version": PROTOCOL_VERSION };
    await postFollowing(url, { jsonrpc: "2.0", method: "notifications/initialized" }, withSession, signal);
    const list = await postFollowing(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, withSession, signal);
    if (list.status === 401 || list.status === 403) return { ok: false, error: "Needs a valid auth header." };
    const listMsg = parseRpc(list.body, String(list.headers["content-type"] ?? ""));
    const tools = (listMsg?.result as { tools?: { name?: unknown; description?: unknown }[] } | undefined)?.tools;
    if (!Array.isArray(tools)) return { ok: false, error: "The server answered, but didn't list its tools." };
    return {
      ok: true,
      serverName: typeof serverName === "string" ? serverName.slice(0, 80) : null,
      tools: tools
        .filter((t) => typeof t.name === "string")
        .slice(0, 100)
        .map((t) => ({ name: String(t.name).slice(0, 80), description: typeof t.description === "string" ? t.description.slice(0, 200) : "" })),
    };
  } catch (err) {
    return { ok: false, error: plainError(err) };
  }
}
