"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button, buttonClasses } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { studioAgents } from "@/server/actions/studio-agents";

export type AttachedAgent = { id: string; name: string };

type Listed = { id: string; name: string; description: string };

/**
 * "Add files, agents or tools" on Home: add files, or attach an existing Lyzr Studio agent (BL-2) for the plan to use
 * as a part instead of building a new one. The list is the workspace's own Studio's, with its own Lyzr key.
 */
export function AddMenu({ onAddFiles, attached, onAttach, disabledReason }: { onAddFiles: () => void; attached: AttachedAgent[]; onAttach: (a: AttachedAgent) => void; disabledReason?: string }) {
  const [open, setOpen] = useState(false);
  const full = attached.length >= 3;
  const openAgents = () => setOpen(true);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-transparent px-3 text-body font-[550] whitespace-nowrap text-ink hover:bg-selected">
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
      <StudioAgentDialog open={open} onOpenChange={setOpen} attached={attached} onAttach={onAttach} />
    </>
  );
}

/**
 * Attach a Lyzr Studio agent (BL-2): the workspace's own Studio agents, listed with its own Lyzr key (M5.10). Without a
 * key there's no list, only the prompt to connect one: nobody ever sees another account's agents. Used by Home's add
 * menu and chat's + menu (M5.8). Up to 3.
 */
export function StudioAgentDialog({ open, onOpenChange, attached, onAttach }: { open: boolean; onOpenChange: (o: boolean) => void; attached: AttachedAgent[]; onAttach: (a: AttachedAgent) => void }) {
  const setOpen = onOpenChange;
  const [list, setList] = useState<{ agents: Listed[]; needsKey: boolean; note?: string } | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  // Loads Studio's list the first time the dialog opens.
  useEffect(() => {
    if (!open || list) return;
    start(async () => {
      setError(undefined);
      const r = await studioAgents();
      if (!r.ok) return setError(r.message);
      setList({ agents: r.agents, needsKey: r.needsKey, note: r.note });
    });
  }, [open, list]);
  const full = attached.length >= 3;
  return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-auto rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[560px]">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1 text-sub font-semibold">Attach a Lyzr Studio agent</DialogTitle>
          </div>
          <DialogDescription className="text-ink-2">
            {list?.needsKey
              ? "Connect this workspace's Lyzr API key to see its Studio agents. Each workspace uses its own Lyzr account."
              : (list?.note ?? "Agents in your workspace's Lyzr Studio. The plan uses the one you pick as a part instead of building a new agent for that job.")}
          </DialogDescription>
          {pending && !list && <p className="text-ink-2">Loading your Studio agents…</p>}
          {error && (
            <p role="alert" className="text-small font-semibold text-failed">
              {error}
            </p>
          )}
          {list?.needsKey && (
            <Link href="/connections#lyzr" className={buttonClasses({ className: "self-start" })} onClick={() => setOpen(false)}>
              Connect your Lyzr key
            </Link>
          )}
          {list && !list.needsKey && !list.note && (list.agents.length ? (
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
  );
}
