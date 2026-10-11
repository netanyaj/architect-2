// Writes src/app/tokens.css from design-system/tokens.json. Run with `pnpm tokens`; never edit tokens.css by hand.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const t = JSON.parse(readFileSync(`${root}design-system/tokens.json`, "utf8"));

const ui = t.color.tokens;
// Brand and art (v4): pictures only. They're CSS variables, not Tailwind colours, so `bg-brand-moss` can't be written.
const art = t.color.art ?? [];
const artVars = (theme) =>
  art.flatMap((tok) => [`  --${tok.name}: ${tok.value[theme]};`, ...(tok.cell ? [`  --${tok.name}-cell: ${tok.cell[theme]};`] : [])]);

const shadows = Object.fromEntries(t.shadow.tokens.map((s) => [s.name, s.value]));
const textName = { display: "display", title: "title", heading: "heading", subheading: "sub", body: "body", small: "small" };
const texts = t.type.groups.flatMap((g) => g.styles).filter((s) => textName[s.name]);

const lines = [
  `/* Architect 2.0 · Soft Tray tokens (design system v${t.version}). Generated from design-system/tokens.json. Do not edit by hand. */`,
  `@import "tailwindcss";`,
  ``,
  `:root {`,
  ...ui.map((tok) => `  --${tok.name}: ${tok.value.light};`),
  ...t.spacing.tokens.map((s) => `  --${s.name}: ${s.value};`),
  ...t.radius.tokens.map((r) => `  --${r.name}: ${r.value};`),
  ...t.size.tokens.map((s) => `  --${s.name}: ${s.value};`),
  `  --ax-shadow-pane: ${shadows["shadow-pane"]};`,
  `  --ax-shadow-hero: ${shadows["shadow-hero"]};`,
  `  --ax-shadow-pop: ${shadows["shadow-pop"]};`,
  `  --ax-shadow-drawer: ${shadows["shadow-drawer"]};`,
  `  --font-sans: ${t.type.families.sans};`,
  `  --font-mono: ${t.type.families.mono};`,
  ...(art.length
    ? [
        ``,
        `  /* Brand and art (v4). FOR PICTURES ONLY: the logo mark, the greeting's full stop, the credits bar, mosaics, agent`,
        `     glyphs and the build loader. Never on a button, badge, link, status or text next to a status. */`,
        ...artVars("light"),
      ]
    : []),
  `}`,
  ``,
  `/* Dark: Developer view default, or the user's theme setting. Set data-theme="dark" on <html>. */`,
  `[data-theme="dark"] {`,
  ...ui.map((tok) => `  --${tok.name}: ${tok.value.dark};`),
  ...(art.length ? [`  /* Brand and art: pictures only. */`, ...artVars("dark")] : []),
  `  color-scheme: dark;`,
  `}`,
  ``,
  `@theme inline {`,
  ...ui.map((tok) => `  --color-${tok.name}: var(--${tok.name});`),
  `  --font-sans: var(--font-sans);`,
  `  --font-mono: var(--font-mono);`,
  ...t.radius.tokens.filter((r) => r.name !== "radius-pill").map((r) => `  --${r.name}: ${r.value};`),
  `  --shadow-pane: var(--ax-shadow-pane);`,
  `  --shadow-pop: var(--ax-shadow-pop);`,
  `  --shadow-hero: var(--ax-shadow-hero);`,
  `  --shadow-drawer: var(--ax-shadow-drawer);`,
  ...texts.map((s) => `${`  --text-${textName[s.name]}: ${s.fontSize};`.padEnd(25)}--text-${textName[s.name]}--line-height: ${s.lineHeight};`),
  // Headings are tracked in (M5.9): −0.02em at 28px and up, −0.01em at 20px.
  ...texts.filter((s) => s.letterSpacing?.endsWith("em")).map((s) => `  --text-${textName[s.name]}--letter-spacing: ${s.letterSpacing};`),
  `}`,
  ``,
  `body { background: var(--canvas); color: var(--ink); font-family: var(--font-sans); font-size: 14px; line-height: 21px; font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }`,
  `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`,
];

writeFileSync(`${root}src/app/tokens.css`, `${lines.join("\n")}\n`);
console.log(`tokens.css written (v${t.version}, ${ui.length} UI colours, ${art.length} brand and art).`);
