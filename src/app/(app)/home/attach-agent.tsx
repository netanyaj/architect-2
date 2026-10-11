"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { studioAgents } from "@/server/actions/studio-agents";

export type AttachedAgent = { id: string; name: string };

type Listed = { id: string; name: string; description: string };

/**
 * "Add files, agents or tools" on Home: add files, or attach an existing Lyzr Studio agent (BL-2) for the plan to use
 * as a part instead of building a new one. The list is Studio's own (real) when a Lyzr key is set.
 */
export function AddMenu({ onAddFiles, attached, onAttach, disabledReason }: { onAddFiles: () => void; attached: AttachedAgent[]; onAttach: (a: AttachedAgent) => void; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<{ agents: Listed[]; simulated: boolean; note?: string } | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const openAgents = () => {
    setOpen(true);
    setError(undefined);
    start(async () => {
      const r = await studioAgents();
      if (!r.ok) return setError(r.message);
      setList({ agents: r.agents, simulated: r.simulated, note: r.note });
    });
  };
  const full = attached.length >= 3;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line-ctl bg-surface px-3 text-body font-[550] whitespace-nowrap text-ink hover:bg-selected">
          <Icon name="plus" size="sm" />
          Add files, agents or tools
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <DropdownMenuItem onSelect={onAddFiles} className="flex min-h-11 flex-col items-start gap-0 rounded-tile px-2.5 py-1.5">
            <span className="font-semibold">Add files</span>
            <span className="text-small text-ink-2">PDFs become a knowledge base; CSV and Excel files the test version&apos;s data</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={Boolean(disabledReason) || full}
            onSelect={openAgents}
            className="flex min-h-11 flex-col items-start gap-0 rounded-tile px-2.5 py-1.5"
          >
            <span className="font-semibold">Attach a Lyzr Studio agent</span>
            <span className="text-small text-ink-2">{disabledReason ?? (full ? "Up to 3 agents" : "Use an agent you already have as a part")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-auto rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[560px]">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1 text-sub font-semibold">Attach a Lyzr Studio agent</DialogTitle>
            {list?.simulated && <SimTag title={list.note} />}
          </div>
          <DialogDescription className="text-ink-2">
            {list?.simulated
              ? list.note
              : "Agents in Lyzr Studio (this prototype's shared Studio account). The plan uses the one you pick as a part instead of building a new agent for that job."}
          </DialogDescription>
          {pending && !list && <p className="text-ink-2">Loading your Studio agents…</p>}
          {error && (
            <p role="alert" className="text-small font-semibold text-failed">
              {error}
            </p>
          )}
          {list && (list.agents.length ? (
            <ul aria-label="Studio agents" className="flex flex-col divide-y divide-line rounded-card border border-line">
              {list.agents.map((a) => {
                const on = attached.some((x) => x.id === a.id);
                return (
                  <li key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className={cn("min-w-0 flex-1", on && "text-ink-2")}>
                      <span className="block font-semibold">{a.name}</span>
                      {a.description && <span className="block text-small text-ink-2">{a.description}</span>}
                    </span>
                    <Button size="sm" disabledReason={on ? "Already attached." : full ? "Up to 3 agents." : undefined} onClick={() => (onAttach({ id: a.id, name: a.name }), setOpen(false))}>
                      {on ? "Attached" : "Attach"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-ink-2">There are no agents in Studio yet. Describe the agent you want instead, and the plan builds it.</p>
          ))}
        </DialogContent>
      </Dialog>
    </>
  );
}
