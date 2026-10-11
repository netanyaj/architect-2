import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { accentFor, ACCENTS, agentRole, emptyParts, hash, mosaicFor, templateParts, toneFor } from "@/lib/brand";

const root = join(__dirname, "../..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(f) ? [p] : [];
  });
}

describe("brand and art tokens are for pictures only (Soft Tray v4)", () => {
  // The only places a brand or art colour may appear: the pictures, the logo mark, the greeting's full stop and the
  // credits bar fill. Anything else (a button, badge, link or status) fails here.
  const ALLOWED = new Set([
    "src/app/tokens.css",
    "src/app/globals.css", // the build loader's keyframes
    "src/components/ax/MosaicThumb.tsx",
    "src/components/ax/AgentGlyph.tsx",
    "src/components/ax/logo-mark.tsx",
    "src/components/ax/side-nav.tsx", // the credits bar fill
    "src/app/(app)/home/home-composer.tsx", // the greeting's full stop
  ]);

  it("appear only in the picture components and the three brand touches", () => {
    const offenders = files(join(root, "src"))
      .filter((f) => /--(brand|art)-/.test(readFileSync(f, "utf8")))
      .map((f) => relative(root, f))
      .filter((f) => !ALLOWED.has(f));
    expect(offenders).toEqual([]);
  });

  it("aren't Tailwind colours, so no utility class can paint UI with them", () => {
    const css = readFileSync(join(root, "src/app/tokens.css"), "utf8");
    expect(css).not.toMatch(/--color-(brand|art)-/);
    const used = files(join(root, "src")).filter((f) => /\b(bg|text|fill|stroke|border|ring|outline)-(brand|art)-/.test(readFileSync(f, "utf8")));
    expect(used).toEqual([]);
  });

  it("the credits bar uses moss on its fill only, and the greeting on its full stop only", () => {
    const nav = readFileSync(join(root, "src/components/ax/side-nav.tsx"), "utf8");
    expect(nav.match(/--brand-moss/g)).toHaveLength(1);
    const home = readFileSync(join(root, "src/app/(app)/home/home-composer.tsx"), "utf8");
    expect(home).toMatch(/<span style=\{\{ color: "var\(--brand-moss\)" \}\}>\.<\/span>/);
  });

  it("tokens.json holds the eight tokens with a light and a dark value, and the CSS is generated from it", () => {
    const t = JSON.parse(readFileSync(join(root, "design-system/tokens.json"), "utf8"));
    expect(t.version).toBe(4);
    expect(t.color.art.map((x: { name: string }) => x.name)).toEqual(["brand-moss", "brand-fern", "brand-lime", "brand-mist", "art-peony", "art-tangerine", "art-yolk", "art-lilac"]);
    const css = readFileSync(join(root, "src/app/tokens.css"), "utf8");
    for (const tok of t.color.art) {
      expect(css).toContain(`--${tok.name}: ${tok.value.light};`);
      expect(css).toContain(`--${tok.name}: ${tok.value.dark};`);
    }
    expect(css).toContain("--brand-mist-cell: #E2E8DC;");
    expect(css).toContain("--brand-mist-cell: #2A332B;");
  });
});

describe("mosaics", () => {
  const parts = [
    { id: "a1", status: "built" },
    { id: "b2", status: "building" },
    { id: "c3", status: "agreed" },
    { id: "d4", status: "dropped" },
    { id: "e5", status: "sample_data" },
  ];

  it("one column per part (dropped and deferred aren't drawn), toned by status", () => {
    const m = mosaicFor("p1", parts);
    expect(m.columns.map((c) => c.tone)).toEqual(["moss", "fern", "mist", "moss"]);
    expect(toneFor("failed")).toBe("fern");
    expect(toneFor("needs_connection")).toBe("mist");
  });

  it("heights come from the part id, so the picture is the same on every render", () => {
    expect(mosaicFor("p1", parts)).toEqual(mosaicFor("p1", parts));
    for (const c of mosaicFor("p1", parts).columns) expect(c.height).toBeGreaterThanOrEqual(1);
    for (const c of mosaicFor("p1", parts).columns) expect(c.height).toBeLessThanOrEqual(4);
    expect(mosaicFor("p1", parts).columns[0].height).toBe(1 + (hash("a1") % 4));
  });

  it("exactly one accent cell, inside a drawn column, in the project's accent", () => {
    const m = mosaicFor("p1", parts);
    expect(m.accent.row).toBeLessThan(m.columns[m.accent.column].height);
    expect(m.accent.colour).toBe(accentFor("p1"));
    expect(ACCENTS).toContain(accentFor("anything"));
  });

  it("projects spread across the four accents", () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => accentFor(`project-${i}`)));
    expect(seen.size).toBe(4);
  });

  it("crops to 4 columns for the header, caps at 8, and draws a quiet row before there's a plan", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, status: "built" }));
    expect(mosaicFor("p", many, 4).columns).toHaveLength(4);
    expect(mosaicFor("p", many).columns).toHaveLength(8);
    expect(mosaicFor("p", []).columns.every((c) => c.tone === "mist")).toBe(true);
  });

  it("templates are all finished; empty states mix mist and moss", () => {
    expect(templateParts("meeting-briefs", 160).every((p) => p.status === "built")).toBe(true);
    const tones = new Set(mosaicFor("projects", emptyParts("projects")).columns.map((c) => c.tone));
    expect([...tones].every((t) => t === "mist" || t === "moss")).toBe(true);
  });
});

describe("agent roles", () => {
  it("maps the existing agents, and anything unknown is custom", () => {
    expect(agentRole("Brief writer")).toBe("writer");
    expect(agentRole("Research agent")).toBe("extractor");
    expect(agentRole("Urgency and team label")).toBe("router");
    expect(agentRole("Draft reply for simple tickets")).toBe("writer");
    expect(agentRole("Lead scorer")).toBe("checker");
    expect(agentRole("Daily digest")).toBe("notifier");
    expect(agentRole("Weekly metrics report")).toBe("data analyst");
    expect(agentRole("Meeting scheduler")).toBe("planner");
    expect(agentRole("Zork", "Does something new")).toBe("custom");
    expect(agentRole("Helper", "Sends an alert when a deal stalls")).toBe("notifier");
  });
});
