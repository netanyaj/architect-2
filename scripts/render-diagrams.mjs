// Renders the architecture diagrams from their editable sources in docs/product/diagrams/src/:
//   *.mmd  Mermaid, rendered in Chromium with mermaid (from jsDelivr) and the shared _config.json
//   *.svg  hand-made SVG (from the hero.py / prototype.py generators), copied and rasterised
// Writes <name>.svg and <name>.png (2×) beside the sources' folder. Usage: node scripts/render-diagrams.mjs [name…]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "docs/product/diagrams");
const SRC = path.join(DIR, "src");
const wanted = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(path.join(SRC, "_config.json"), "utf8"));
const sources = fs.readdirSync(SRC).filter((f) => /\.(mmd|svg)$/.test(f) && (!wanted.length || wanted.some((w) => f.startsWith(w))));

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 1200 } });
await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff"><div id="out"></div><script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"></script></body></html>`);
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
