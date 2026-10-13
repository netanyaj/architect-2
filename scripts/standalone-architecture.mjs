// Writes a standalone copy of docs/product/ARCHITECTURE.md that works when downloaded on its own (it isn't kept in the repo).
// - every image and every ```mermaid block becomes a PNG from raw.githubusercontent.com (the separate [PNG] links go);
// - links to other files in the repo point at github.com;
// - <details> sections become plain sections, since many Markdown viewers don't support them.
// Usage: node scripts/standalone-architecture.mjs <output file>, e.g. ~/Downloads/ARCHITECTURE-standalone.md
import fs from "node:fs";
import path from "node:path";

const REPO = "netanyaj/architect-2";
const RAW = `https://raw.githubusercontent.com/${REPO}/main/`;
const BLOB = `https://github.com/${REPO}/blob/main/`;
const TREE = `https://github.com/${REPO}/tree/main/`;
const DOC_DIR = "docs/product";
const root = process.cwd();
const src = path.join(root, DOC_DIR, "ARCHITECTURE.md");
const out = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!out) {
  console.error("Usage: node scripts/standalone-architecture.mjs <output file>");
  process.exit(1);
}

/** A path relative to docs/product, as a path from the repo root. */
const fromRoot = (rel) => path.posix.normalize(path.posix.join(DOC_DIR, rel));
const isRelative = (url) => !/^([a-z]+:|#|\/)/i.test(url);

let doc = fs.readFileSync(src, "utf8");

// Mermaid: the block (and its PNG link under it) becomes the rendered PNG, with any caption kept under the picture.
doc = doc.replace(/```mermaid\n(?:(?!```)[\s\S])*?\n```\n((?:_[^\n]*_\n\n)?)\[PNG\]\(([^)]+)\)/g, (_, caption, png) => {
  // "A5-deployment-modes" reads as "Diagram A5: deployment modes".
  const name = path.posix.basename(png, ".png").replace(/^([A-Z]\d+b?)-/, "$1: ").replace(/-/g, " ");
  return `![Diagram ${name}](${RAW}${fromRoot(png)})\n\n${caption}`.trimEnd();
});

// Images: absolute raw URLs.
doc = doc.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => (isRelative(url) ? `![${alt}](${RAW}${fromRoot(url)})` : m));

// Links to other files in the repo: github.com (folders as trees). Anchors within the page stay as they are.
doc = doc.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, text, url) => {
  if (!isRelative(url)) return m;
  const [file, hash] = url.split("#");
  const p = fromRoot(file);
  const base = file.endsWith("/") || (fs.existsSync(path.join(root, p)) && fs.statSync(path.join(root, p)).isDirectory()) ? TREE : BLOB;
  return `[${text}](${base}${p.replace(/\/$/, "")}${hash ? `#${hash}` : ""})`;
});

// <details> becomes a plain section: the summary is dropped where a heading follows it, else kept as a bold line.
const lines = doc.split("\n");
const outLines = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^\s*<\/?details>\s*$/.test(line)) continue;
  const summary = /^\s*<summary>(.*)<\/summary>\s*$/.exec(line);
  if (summary) {
    const nextText = lines.slice(i + 1).find((l) => l.trim() !== "") ?? "";
    if (/^#{1,6} /.test(nextText)) continue;
    // "<b>3.1 Web app…</b> · click to open" becomes the subsection's heading; other summaries a bold line.
    const text = summary[1].replace(/<\/?b>/g, "").replace(/^Show (\w)/, (_, c) => c.toUpperCase());
    outLines.push(/^\d+\.\d+ /.test(text) ? `### ${text}` : `**${text}**`);
    continue;
  }
  outLines.push(line);
}
doc = outLines.join("\n").replace(/\n{3,}/g, "\n\n");

// The note about folded sections doesn't apply here.
doc = doc.replace(/\nEach component below opens with a click\.\n/, "");

// Under the title: where to read it best.
doc = doc.replace(/^(# [^\n]+\n)/, `$1\nBest viewed on GitHub: https://github.com/${REPO}/blob/main/${DOC_DIR}/ARCHITECTURE.md\n`);

fs.writeFileSync(out, doc);

const images = [...doc.matchAll(/!\[[^\]]*\]\((https:[^)\s]+)\)/g)].map((m) => m[1]);
const leftovers = { mermaid: (doc.match(/```mermaid/g) ?? []).length, png: (doc.match(/\[PNG\]\(/g) ?? []).length, details: (doc.match(/<\/?details>|<summary>/g) ?? []).length };
console.log(`${out} written: ${images.length} images, leftovers ${JSON.stringify(leftovers)}`);
if (process.argv.includes("--list")) for (const u of images) console.log(u);
