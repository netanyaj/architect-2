/**
 * The Developer view terminal (M5.5). Nothing is ever run in a shell: a short list of commands is parsed here and
 * mapped to real project data on the server (the parts' checks, the branch's edits, the file tree). Anything else
 * gets one honest line. Shared by client and server; no I/O.
 */

export type Command =
  | { kind: "test"; tool: "npm test" | "pytest" }
  | { kind: "status" }
  | { kind: "diff"; path: string | null }
  | { kind: "ls"; path: string }
  | { kind: "cat"; path: string }
  | { kind: "clear" }
  | { kind: "help" }
  | { kind: "other" }
  | { kind: "invalid"; reason: string };

export const SANDBOX_LINE = "Runs in your project's sandbox in Architect 2.0";
export const MAX_COMMAND = 200;

/** A relative path inside the project: no "..", no absolute paths, no shell characters. */
function cleanPath(raw: string | undefined): string | null {
  if (raw === undefined) return "";
  if (raw.startsWith("/") || raw.startsWith("~")) return null;
  const p = raw.replace(/^\.\//, "").replace(/\/+$/, "");
  if (p === "." || p === "") return "";
  if (p.startsWith("/") || p.split("/").some((s) => s === ".." || s === "") || !/^[\w.@+\-/ ]+$/.test(p) || p.length > 300) return null;
  return p;
}

export function parseCommand(input: string): Command {
  const line = input.trim();
  if (!line) return { kind: "invalid", reason: "Type a command." };
  if (line.length > MAX_COMMAND) return { kind: "invalid", reason: `Commands are up to ${MAX_COMMAND} characters.` };
  // Pipes, redirects, chaining and substitution are never run: the whole line is "other".
  if (/[|;&><`$\\]/.test(line)) return { kind: "other" };
  const [cmd, ...args] = line.split(/\s+/);
  const sub = args[0];
  if (line === "npm test" || line === "npm run test") return { kind: "test", tool: "npm test" };
  if (cmd === "pytest" && args.length === 0) return { kind: "test", tool: "pytest" };
  if (cmd === "git" && sub === "status" && args.length === 1) return { kind: "status" };
  if (cmd === "git" && sub === "diff" && args.length <= 2) {
    const p = cleanPath(args[1]);
    return p === null ? { kind: "invalid", reason: "That isn't a path in this project." } : { kind: "diff", path: p || null };
  }
  if (cmd === "ls" && args.length <= 1) {
    const p = cleanPath(args[0]);
    return p === null ? { kind: "invalid", reason: "That isn't a path in this project." } : { kind: "ls", path: p };
  }
  if (cmd === "cat" && args.length === 1) {
    const p = cleanPath(args[0]);
    if (p === null) return { kind: "invalid", reason: "That isn't a path in this project." };
    return p ? { kind: "cat", path: p } : { kind: "invalid", reason: "cat needs a file path, like cat README.md." };
  }
  if (line === "clear") return { kind: "clear" };
  if (line === "help") return { kind: "help" };
  return { kind: "other" };
}

export const HELP_LINES = [
  "npm test, pytest   run each built part's check again",
  "git status         what's changed on the branch",
  "git diff [path]    the changes, line by line",
  "ls [folder]        list files",
  "cat <file>         show a file",
  "clear              clear the screen",
];

/** The entries directly inside `dir` ("" is the root): folders end in "/". */
export function listDir(paths: string[], dir: string): string[] | null {
  const prefix = dir ? `${dir}/` : "";
  const inside = paths.filter((p) => p.startsWith(prefix));
  if (dir && !inside.length) return null;
  const names = new Set(inside.map((p) => {
    const rest = p.slice(prefix.length);
    const i = rest.indexOf("/");
    return i === -1 ? rest : `${rest.slice(0, i)}/`;
  }));
  return [...names].sort((a, b) => Number(b.endsWith("/")) - Number(a.endsWith("/")) || a.localeCompare(b));
}
