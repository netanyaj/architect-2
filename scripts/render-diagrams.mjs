// Renders the architecture diagrams from their editable sources in docs/product/diagrams/src/:
//   *.mmd  Mermaid, rendered in Chromium with mermaid (from jsDelivr) and the shared _config.json
//   *.svg  hand-made SVG (from the hero.py, prototype.py and system_map.py generators), copied and rasterised
// Writes <name>.svg and <name>.png (2×) beside the sources' folder, and copies each Mermaid source into its ```mermaid
// block in ARCHITECTURE.md (the block just above its [PNG](diagrams/<name>.png) link). Usage: node scripts/render-diagrams.mjs [name…]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "docs/product/diagrams");
const SRC = path.join(DIR, "src");
const wanted = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path.join(SRC, "_config.json"), "utf8"));
const sources = fs.readdirSync(SRC).filter((f) => /\.(mmd|svg)$/.test(f) && (!wanted.length || wanted.some((w) => f.startsWith(w))));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2000, height: 1600 } });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff;font-family:Arial,sans-serif"><div id="out"></div><script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script></body></html>`);
await page.waitForFunction(() => "mermaid" in window);
await page.evaluate((cfg) => window.mermaid.initialize({ startOnLoad: false, ...cfg }), config);

for (const file of sources) {
  const name = file.replace(/\.(mmd|svg)$/, "");
  let svg = fs.readFileSync(path.join(SRC, file), "utf8");
  if (file.endsWith(".mmd")) {
    svg = await page.evaluate(async ([id, code]) => (await window.mermaid.render(id, code)).svg, [`d${name.replace(/\W/g, "")}`, svg]);
  }
  fs.writeFileSync(path.join(DIR, `${name}.svg`), svg);
  await page.evaluate((s) => (document.getElementById("out").innerHTML = s), svg);
  const el = page.locator("#out > svg");
  // Mermaid sizes with max-width; give the PNG its natural width so text stays crisp.
  await el.evaluate((n) => {
    const vb = n.viewBox.baseVal;
    if (vb && vb.width) {
      n.style.maxWidth = "none";
      n.setAttribute("width", String(vb.width));
      n.setAttribute("height", String(vb.height));
    }
  });
  await el.screenshot({ path: path.join(DIR, `${name}.png`), omitBackground: false });
  console.log("rendered", name);
}
await browser.close();

// ARCHITECTURE.md shows each Mermaid diagram as a ```mermaid block (GitHub renders it), with its PNG linked under it.
const docPath = path.join(DIR, "..", "ARCHITECTURE.md");
let doc = fs.readFileSync(docPath, "utf8");
for (const file of sources.filter((f) => f.endsWith(".mmd"))) {
  const name = file.replace(/\.mmd$/, "");
  const code = fs.readFileSync(path.join(SRC, file), "utf8").trimEnd();
  // The block's body may not contain another fence, so the match never spans two blocks.
  const block = new RegExp("```mermaid\\n(?:(?!```)[\\s\\S])*?\\n```\\n((?:_[^\\n]*_\\n\\n)?\\[PNG\\]\\(diagrams/" + name + "\\.png\\))");
  if (block.test(doc)) doc = doc.replace(block, (_, link) => "```mermaid\n" + code + "\n```\n" + link);
  else console.log("no block in ARCHITECTURE.md for", name);
}
fs.writeFileSync(docPath, doc);
