"use client";

import { useEffect, useState } from "react";
import { accentFor, hash, type AgentRole } from "@/lib/brand";
import { SHAPES } from "./AgentGlyph";

const SIZE = 64;
const PITCH = (SIZE * 0.7) / 7;
const ORIGIN = (SIZE - PITCH * 7) / 2;
const DOT = PITCH * 0.74;
/** 500ms for the dots to come in, then held for 900ms. */
const FRAME_MS = 1400;

const lit = (role: AgentRole) => SHAPES[role].flatMap((row) => [...row].map((c) => c === "x"));
// Each dot comes in about 15ms after the ring inside it: the shape grows from the centre outwards.
const delay = (i: number) => Math.round(Math.hypot((i % 7) - 3, Math.floor(i / 7) - 3) * 15);

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(q.matches);
    sync();
    q.addEventListener("change", sync);
    return () => q.removeEventListener("change", sync);
  }, []);
  return reduced;
}

/**
 * The build loader (Soft Tray v4, dotted since M5.9): a 7×7 dot grid on a mist tile that morphs between the agent
 * glyphs of the parts being built, in build order, with one dot in the project's accent. The build's progress line
 * sits under it in Geist Mono ("Build 2/5 · Building Policy check"). Under reduced motion it's a still ring.
 * One <span> per dot and CSS transitions: no canvas, no library. Decorative; the caption carries the meaning.
 */
export function BuildLoader({
  step,
  roles = ["planner", "checker", "writer"],
  seed = "architect",
  children,
}: {
  step: string;
  /** The glyphs to morph through (see loaderRoles). */
  roles?: AgentRole[];
  /** The project's id: its accent, the same as its mosaic's. */
  seed?: string;
  children?: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const [frame, setFrame] = useState(0);
  const sequence = roles.length ? roles : (["planner"] as AgentRole[]);
  useEffect(() => {
    if (reduced) return;
    const t = window.setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => window.clearInterval(t);
  }, [reduced]);

  const role: AgentRole = reduced ? "planner" : sequence[frame % sequence.length];
  const on = lit(role);
  const litIndexes = on.flatMap((v, i) => (v ? [i] : []));
  const accentAt = reduced ? -1 : litIndexes[hash(`${seed}:${frame}`) % litIndexes.length];
  const accent = `var(--art-${accentFor(seed)})`;

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span
        aria-hidden="true"
        data-role={role}
        className="relative block flex-none rounded-[12px]"
        style={{ width: SIZE, height: SIZE, background: "var(--brand-mist)" }}
      >
        {on.map((v, i) => (
          <span
            key={i}
            className="absolute rounded-full transition-[opacity,transform,background-color] duration-500 ease-out motion-reduce:transition-none"
            style={{
              left: ORIGIN + (i % 7) * PITCH + (PITCH - DOT) / 2,
              top: ORIGIN + Math.floor(i / 7) * PITCH + (PITCH - DOT) / 2,
              width: DOT,
              height: DOT,
              background: i === accentAt ? accent : v ? "var(--brand-moss)" : "var(--brand-mist-cell)",
              opacity: v ? 1 : 0.55,
              transform: `scale(${v ? 1 : 0.4})`,
              transitionDelay: `${delay(i)}ms`,
            }}
          />
        ))}
      </span>
      <p className="max-w-[420px] font-mono text-small text-ink-2">{step}</p>
      {children}
    </div>
  );
}
