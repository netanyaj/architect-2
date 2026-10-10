import type { Metadata } from "next";
import Link from "next/link";
import { ToolInitials, IconTile } from "@/components/ax/list-row";
import { SimTag, Tag } from "@/components/ax/pill";
import { STARTERS } from "@/lib/templates";

export const metadata: Metadata = { title: "Marketplace · Architect" };

/** Apps and Agentlets to start from. Picking one opens Home with its prompt filled in. Publishing is simulated. */
export default function MarketplacePage() {
  const listed = STARTERS.filter((s) => s.kind !== "Prompt");
  return (
    <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-[22px] px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-[650]">Marketplace</h1>
        <p className="flex flex-wrap items-center gap-2 text-ink-2">
          Working apps and Agentlets to start from. Listing your own app is simulated in this prototype.
          <SimTag />
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {listed.map((s) => (
          <Link
            key={s.id}
            href={`/home?starter=${s.id}`}
            className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4 text-ink no-underline hover:border-line-ctl"
          >
            <span className="flex items-center justify-between">
              <IconTile icon={s.icon} />
              <Tag>{s.kind}</Tag>
            </span>
            <span className="font-semibold">{s.name}</span>
            <span className="text-small text-ink-2">{s.description}</span>
            <span className="mt-auto flex items-center gap-2 text-small text-ink-2">
              <ToolInitials tools={s.tools} />
              {s.credits && <span className="tabular-nums">~{s.credits} credits</span>}
            </span>
            <span className="text-small font-semibold underline decoration-line-ctl underline-offset-[3px]">Use as a starting point</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
