import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type VersionCard = {
  id: "test" | "team" | "live";
  order: "Now" | "Next" | "Then";
  name: "Test version" | "Team version" | "Live";
  audience: string;
  status?: ReactNode;
};

/** The three versions on the Launch stage. The target version gets a 2px ink border. */
export function VersionCards({
  cards,
  target,
  onSelect,
}: {
  cards: VersionCard[];
  target: VersionCard["id"];
  onSelect?: (id: VersionCard["id"]) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Versions" className="grid gap-2.5 sm:grid-cols-3">
      {cards.map((c) => {
        const on = c.id === target;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onSelect?.(c.id)}
            className={cn(
              "flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3.5 text-left transition-colors",
              on ? "border-2 border-ink p-[13px]" : "hover:border-line-ctl",
            )}
          >
            <span className="text-small font-[650] text-ink-3">{c.order}</span>
            <span className="font-semibold">{c.name}</span>
            <span className="text-small text-ink-2">{c.audience}</span>
            {c.status && <span className="text-small">{c.status}</span>}
          </button>
        );
      })}
    </div>
  );
}
