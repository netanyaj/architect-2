// QA helper: node scripts/screenshot.mjs <url> <out.png> [width] [height] [fullPage 1|0] [theme light|dark]
// Prints console errors so a screen can be checked against docs/screens/.
import { chromium } from "@playwright/test";

const [, , url, out, w = "1440", h = "900", full = "1", theme = "light"] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "networkidle" });
if (theme === "dark") {
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(150);
}
await page.screenshot({ path: out, fullPage: full === "1" });
console.log(errors.length ? `console errors:\n${errors.slice(0, 10).join("\n")}` : "no console errors");
await browser.close();
