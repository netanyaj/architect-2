"use client";

import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { matchesStarter, STARTERS, type Starter } from "@/lib/templates";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { ToolInitials } from "./list-row";
import { Segmented } from "./segmented";
import { TemplateCard } from "./template-card";
import { MosaicThumb } from "./MosaicThumb";
import { templateParts } from "@/lib/brand";

type Tab = "Template" | "Agentlet" | "Prompt";
const TEAMS = ["Sales", "Support", "Ops", "HR", "Finance"] as const;

/** Screen 15: start from something that works. Picking one fills the Home prompt so it can be changed first. */
export function TemplatesDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (starter: Starter) => void;
}) {
  const [tab, setTab] = useState<Tab>("Template");
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState<string | null>(null);
  const searchId = useId();

  const shown = STARTERS.filter((s) => s.kind === tab && matchesStarter(s, query) && (!team || s.team === team));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-40px)] gap-4 overflow-auto rounded-pane border border-line bg-surface p-5 shadow-pop sm:max-w-[920px]"
      >
        <div className="flex flex-wrap items-center gap-3">
          <DialogTitle className="flex-1 text-heading font-[650]">Start from something that works</DialogTitle>
          <label htmlFor={searchId} className="sr-only">
            Search by job or tool
          </label>
          <input
            id={searchId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by job or tool…"
            className="min-h-[38px] w-[260px] rounded-full border border-line-ctl bg-surface px-4 placeholder:text-ink-3 max-sm:w-full"
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="grid size-[38px] place-items-center rounded-full hover:bg-selected"
          >
            <Icon name="close" size="sm" />
          </button>
        </div>
        <DialogDescription className="sr-only">Pick a starting point to fill in your prompt.</DialogDescription>

        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Kind"
            value={tab}
            onChange={setTab}
            options={[
              { value: "Template", label: "Templates" },
              { value: "Agentlet", label: "Agentlets" },
              { value: "Prompt", label: "Prompts" },
            ]}
          />
          <span className="flex-1" />
          <div role="group" aria-label="Team" className="flex flex-wrap items-center text-small text-ink-2">
            {TEAMS.map((t, i) => (
              <span key={t} className="inline-flex items-center">
                {i > 0 && <span aria-hidden="true" className="px-1">·</span>}
                <button
                  type="button"
                  aria-pressed={team === t}
                  onClick={() => setTeam(team === t ? null : t)}
                  className={cn("min-h-6 rounded px-0.5 hover:text-ink", team === t && "font-semibold text-ink underline underline-offset-[3px]")}
                >
                  {t}
                </button>
              </span>
            ))}
          </div>
        </div>

        {shown.length ? (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {shown.map((s) => (
              <TemplateCard
                key={s.id}
                icon={s.icon}
                picture={<MosaicThumb seed={s.id} parts={templateParts(s.id, s.credits)} />}
                name={s.name}
                description={s.description}
                footer={
                  <span className="flex items-center gap-2 text-ink-2">
                    <ToolInitials tools={s.tools} />
                    {s.credits ? <span className="tabular-nums">~{s.credits} credits</span> : s.tools.join(", ")}
                  </span>
                }
                onPick={() => onPick(s)}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-card bg-tray px-4 py-6 text-center text-ink-2">
            Nothing matches that. Try another word, or describe what you need on Home.
          </p>
        )}
        <p className="text-small text-ink-2">Picking one fills in the prompt on Home, so you can change it before Architect writes the plan.</p>
      </DialogContent>
    </Dialog>
  );
}
