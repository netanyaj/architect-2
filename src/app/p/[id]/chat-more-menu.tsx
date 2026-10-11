"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { Icon, type IconName } from "@/components/ax/icon";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { canBuild } from "@/lib/permissions";
import { saveComposerSettings } from "@/server/actions/chat";
import type { ProjectWorkspace, WorkspaceItem } from "@/server/project";

function Row({ icon, title, line, onSelect, disabledReason }: { icon: IconName; title: string; line: string; onSelect: () => void; disabledReason?: string }) {
  return (
    <DropdownMenuItem className="flex min-h-11 items-center gap-2.5 rounded-tile px-2.5 py-1.5" disabled={Boolean(disabledReason)} title={disabledReason} onSelect={onSelect}>
      <Icon name={icon} size="sm" className="text-ink-2" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-small text-ink-2">{disabledReason ?? line}</span>
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The composer's ⋯ menu (M5.8): Lock parts (Architect can't change the parts you pick) and Project instructions.
 * Each is a row with one line. Base44's "Auto-approve" isn't carried over: rule 1 holds (docs/DECISIONS.md).
 */
export function ChatMoreMenu({ project, items }: { project: ProjectWorkspace; items: WorkspaceItem[] }) {
  const [open, setOpen] = useState<"lock" | "instructions" | null>(null);
  const reason = canBuild(project.role) ? undefined : "Viewers can't change a project's settings.";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="More for messages" title="More for messages" className="grid size-8 flex-none place-items-center rounded-full border border-transparent bg-tray text-ink hover:bg-selected">
          <Icon name="more" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" collisionPadding={12} className="w-[300px] rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <Row
            icon="lock"
            title={project.locked.length ? `Lock parts · ${project.locked.length} locked` : "Lock parts"}
            line="Architect can't change the parts you pick"
            onSelect={() => setOpen("lock")}
            disabledReason={reason}
          />
          <Row
            icon="doc"
            title="Project instructions"
            line={project.instructions ? "Set · what Architect keeps in mind" : "What Architect keeps in mind for every message"}
            onSelect={() => setOpen("instructions")}
            disabledReason={reason}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {open === "lock" && <LockDialog project={project} items={items} onClose={() => setOpen(null)} />}
      {open === "instructions" && <InstructionsDialog project={project} onClose={() => setOpen(null)} />}
    </>
  );
}

function useSave(onClose: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const save = (input: Parameters<typeof saveComposerSettings>[0]) =>
    start(async () => {
      setError(undefined);
      const r = await saveComposerSettings(input);
      if (!r.ok) return setError(r.message);
      router.refresh();
      onClose();
    });
  return { pending, error, save };
}

function LockDialog({ project, items, onClose }: { project: ProjectWorkspace; items: WorkspaceItem[]; onClose: () => void }) {
  const parts = items.filter((i) => i.status !== "dropped");
  const [picked, setPicked] = useState(new Set(project.locked));
  const { pending, error, save } = useSave(onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-auto rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[460px]" showCloseButton={false}>
        <DialogTitle className="text-sub font-semibold">Lock parts</DialogTitle>
        <DialogDescription className="text-ink-2">Architect won&apos;t change or remove a locked part. Change cards leave it out, and say so.</DialogDescription>
        {parts.length ? (
          <fieldset className="flex flex-col divide-y divide-line rounded-card border border-line">
            <legend className="sr-only">Parts to lock</legend>
            {parts.map((p) => (
              <label key={p.key} className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2">
                <input
                  type="checkbox"
                  checked={picked.has(p.key)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(p.key);
                    else next.delete(p.key);
                    setPicked(next);
                  }}
                  className="size-4 accent-[var(--ink)]"
                />
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="text-ink-2">There are no parts yet. Write the plan first.</p>
        )}
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        <DialogFooter className="mt-2 gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabledReason={pending ? "Saving…" : undefined} onClick={() => save({ projectId: project.id, locked: [...picked] })}>
            {pending ? "Saving…" : `Lock ${picked.size} ${picked.size === 1 ? "part" : "parts"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InstructionsDialog({ project, onClose }: { project: ProjectWorkspace; onClose: () => void }) {
  const id = useId();
  const [text, setText] = useState(project.instructions);
  const { pending, error, save } = useSave(onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[480px]" showCloseButton={false}>
        <DialogTitle className="text-sub font-semibold">Project instructions</DialogTitle>
        <DialogDescription className="text-ink-2">Architect keeps these in mind for every message and change in this project.</DialogDescription>
        <label htmlFor={id} className="text-small font-semibold">
          Instructions
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={6}
          placeholder="Keep every message to Slack under 80 words. Our fiscal year starts in April."
          className="rounded-card border border-line-ctl bg-surface px-3.5 py-2.5"
        />
        <span className="text-small text-ink-3 tabular-nums">{text.length} / 2,000</span>
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
        <DialogFooter className="mt-2 gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabledReason={pending ? "Saving…" : undefined} onClick={() => save({ projectId: project.id, instructions: text })}>
            {pending ? "Saving…" : "Save instructions"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
