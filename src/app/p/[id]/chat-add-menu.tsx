"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ax/button";
import { Icon, type IconName } from "@/components/ax/icon";
import { SimTag } from "@/components/ax/pill";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createBrowserDb } from "@/lib/db";
import { STARTERS } from "@/lib/templates";
import { UPLOAD_LIMITS } from "@/lib/uploads";
import { finishUploads, prepareProjectUploads } from "@/server/actions/uploads";
import type { ProjectWorkspace } from "@/server/project";
import { StudioAgentDialog, type AttachedAgent } from "../../(app)/home/attach-agent";

/** Something added to the next chat message: a chip in the composer, and a line the message carries. */
export type ChatAttachment = { id: string; icon: IconName; label: string; line: string; simulated?: boolean };

const row = "flex min-h-11 items-center gap-2.5 rounded-tile px-2.5 py-1.5";

function Row({ icon, title, line, tag, onSelect, disabledReason }: { icon: IconName; title: string; line: string; tag?: ReactNode; onSelect: () => void; disabledReason?: string }) {
  return (
    <DropdownMenuItem className={row} disabled={Boolean(disabledReason)} title={disabledReason} onSelect={onSelect}>
      <Icon name={icon} size="sm" className="text-ink-2" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-small text-ink-2">{disabledReason ?? line}</span>
      </span>
      {tag}
    </DropdownMenuItem>
  );
}

const DRIVE_SAMPLES = ["Q3 pipeline review.gslides", "Vendor contracts 2026.gsheet", "Meeting notes template.gdoc"];

/**
 * The composer's + menu (M5.8, Base44's pattern), in three groups:
 * Files (from your computer, Google Drive (Simulated), earlier uploads); Building blocks (a Lyzr Studio agent, an
 * Agentlet, a template, a repo); Look (the design system, Figma (Simulated), a screenshot). What's added shows as a
 * chip and travels with the next message. Uploads are real (private storage, read by the planner).
 */
export function ChatAddMenu({
  project,
  attached,
  onAdd,
  onPlanView,
  onStatus,
  disabledReason,
}: {
  project: ProjectWorkspace;
  attached: ChatAttachment[];
  onAdd: (a: ChatAttachment) => void;
  onPlanView: () => void;
  /** Upload progress and problems, shown above the composer. */
  onStatus: (text: string | undefined) => void;
  disabledReason?: string;
}) {
  const router = useRouter();
  const files = useRef<HTMLInputElement>(null);
  const shot = useRef<HTMLInputElement>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [drive, setDrive] = useState(false);
  const [figma, setFigma] = useState(false);
  const setStatus = onStatus;
  const figmaId = useId();
  const agents: AttachedAgent[] = attached.filter((a) => a.id.startsWith("agent:")).map((a) => ({ id: a.id.slice(6), name: a.label }));

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list).slice(0, UPLOAD_LIMITS.maxFiles);
    setStatus("Getting the upload ready…");
    const r = await prepareProjectUploads({ projectId: project.id, files: picked.map((f) => ({ name: f.name, type: f.type, size: f.size })) });
    if (!r.ok) return setStatus(r.message);
    const db = createBrowserDb();
    const done: { name: string; path: string }[] = [];
    for (const [i, slot] of r.uploads.entries()) {
      setStatus(`Uploading ${i + 1} of ${r.uploads.length}: ${slot.name}`);
      const file = picked.find((f) => f.name === slot.name)!;
      const { error } = await db.storage.from("uploads").uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
      if (!error) done.push({ name: slot.name, path: slot.path });
    }
    setStatus("Reading your files…");
    const fin = await finishUploads({ projectId: project.id, uploads: done });
    if (!fin.ok) return setStatus(fin.message);
    for (const d of done) onAdd({ id: `file:${d.path}`, icon: /\.(png|jpe?g|webp)$/i.test(d.name) ? "image" : "file", label: d.name, line: `I attached ${d.name}.` });
    setStatus(fin.unreadable.length ? `Couldn't read text from ${fin.unreadable.join(", ")}.` : undefined);
    router.refresh();
  };

  const starter = (kind: "Agentlet" | "Template") =>
    STARTERS.filter((s) => s.kind === kind).map((s) => (
      <DropdownMenuItem
        key={s.id}
        className="flex min-h-10 flex-col items-start gap-0 rounded-tile px-2.5 py-1.5"
        onSelect={() => onAdd({ id: `${kind}:${s.id}`, icon: kind === "Agentlet" ? "agent" : "template", label: s.name, line: `Use the "${s.name}" ${kind.toLowerCase()} as a starting point: ${s.prompt}` })}
      >
        <span className="font-semibold">{s.name}</span>
        {s.description && <span className="line-clamp-1 text-small text-ink-2">{s.description}</span>}
      </DropdownMenuItem>
    ));

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Add files, building blocks or a look"
          title={disabledReason ?? "Add files, building blocks or a look"}
          disabled={Boolean(disabledReason)}
          className="grid size-8 flex-none place-items-center rounded-full border border-transparent bg-tray text-ink hover:bg-selected disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-tray"
        >
          <Icon name="plus" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" collisionPadding={12} className="w-[300px] rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <DropdownMenuLabel className="px-2.5 py-1 text-small font-[650] text-ink-3">Files</DropdownMenuLabel>
          <Row icon="file" title="From your computer" line="PDF, CSV, Excel or an image" onSelect={() => files.current?.click()} />
          <Row icon="drive" title="Google Drive" line="Pick a file from your Drive" tag={<SimTag title="No real Drive account is linked in this prototype" />} onSelect={() => setDrive(true)} />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={row} disabled={project.uploads.length === 0}>
              <Icon name="clock" size="sm" className="text-ink-2" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">Earlier uploads</span>
                <span className="text-small text-ink-2">{project.uploads.length ? `${project.uploads.length} in this project` : "None yet"}</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64 rounded-card border border-line bg-surface p-1.5 shadow-pop">
              {project.uploads.map((u) => (
                <DropdownMenuItem key={u.id} className="flex min-h-10 items-center gap-2 rounded-tile px-2.5" onSelect={() => onAdd({ id: `file:${u.id}`, icon: u.mime?.startsWith("image/") ? "image" : "file", label: u.name, line: `Use ${u.name}, which I uploaded earlier.` })}>
                  <Icon name={u.mime?.startsWith("image/") ? "image" : "file"} size="sm" className="text-ink-2" />
                  <span className="truncate">{u.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuLabel className="px-2.5 py-1 text-small font-[650] text-ink-3">Building blocks</DropdownMenuLabel>
          <Row icon="agent" title="A Lyzr Studio agent" line="Use an agent you already have as a part" onSelect={() => setAgentsOpen(true)} disabledReason={agents.length >= 3 ? "Up to 3 agents" : undefined} />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={row}>
              <Icon name="sparkle" size="sm" className="text-ink-2" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">An Agentlet</span>
                <span className="text-small text-ink-2">A ready-made agent to start from</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop">{starter("Agentlet")}</DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={row}>
              <Icon name="template" size="sm" className="text-ink-2" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">A template</span>
                <span className="text-small text-ink-2">A working app to borrow from</span>
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop">{starter("Template")}</DropdownMenuSubContent>
          </DropdownMenuSub>
          <Row
            icon="repo"
            title="A repo"
            line={project.repo ? `This project is ${project.repo}` : "Import a repo from GitHub (opens Import)"}
            onSelect={() => (project.repo ? onAdd({ id: `repo:${project.repo}`, icon: "repo", label: project.repo, line: `Work from the code in ${project.repo}.` }) : router.push("/import"))}
          />

          <DropdownMenuSeparator className="my-1 h-px bg-line" />
          <DropdownMenuLabel className="px-2.5 py-1 text-small font-[650] text-ink-3">Look</DropdownMenuLabel>
          <Row icon="palette" title="Design system" line="Look and feel, in Plan › Design" onSelect={onPlanView} />
          <Row icon="external" title="Figma" line="Paste a link to a frame" tag={<SimTag title="Figma isn't read in this prototype; the link travels with your message" />} onSelect={() => setFigma(true)} />
          <Row icon="image" title="Screenshot" line="An image of what you want, PNG, JPG or WebP" onSelect={() => shot.current?.click()} />
        </DropdownMenuContent>
      </DropdownMenu>

      <input ref={files} type="file" multiple hidden accept=".pdf,.csv,.xlsx,image/png,image/jpeg,image/webp,application/pdf,text/csv" onChange={(e) => (void upload(e.target.files), (e.target.value = ""))} />
      <input ref={shot} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => (void upload(e.target.files), (e.target.value = ""))} />

      <StudioAgentDialog
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        attached={agents}
        onAttach={(a) => onAdd({ id: `agent:${a.id}`, icon: "agent", label: a.name, line: `Use my Lyzr Studio agent "${a.name}" (${a.id}) as a part instead of building a new one.` })}
      />

      <Dialog open={drive} onOpenChange={setDrive}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1 text-sub font-semibold">Google Drive</DialogTitle>
            <SimTag title="No real Drive account is linked in this prototype" />
          </div>
          <DialogDescription className="text-ink-2">Sample files, as Drive would list them. Nothing is read from a real Drive.</DialogDescription>
          <ul className="flex flex-col divide-y divide-line rounded-card border border-line">
            {DRIVE_SAMPLES.map((name) => (
              <li key={name} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <Button
                  size="sm"
                  onClick={() => {
                    onAdd({ id: `drive:${name}`, icon: "drive", label: name, line: `Use ${name} from my Google Drive (simulated).`, simulated: true });
                    setDrive(false);
                  }}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={figma} onOpenChange={setFigma}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]">
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1 text-sub font-semibold">Figma</DialogTitle>
            <SimTag title="Figma isn't read in this prototype; the link travels with your message" />
          </div>
          <DialogDescription className="text-ink-2">A link to the frame you want the app to look like.</DialogDescription>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const url = String(new FormData(e.currentTarget).get("url") ?? "").trim();
              if (!/^https:\/\/(www\.)?figma\.com\//.test(url)) return setStatus("Paste a figma.com link.");
              onAdd({ id: `figma:${url}`, icon: "external", label: "Figma frame", line: `Match this Figma frame: ${url} (simulated: not read).`, simulated: true });
              setFigma(false);
            }}
          >
            <label htmlFor={figmaId} className="text-small font-semibold">
              Figma link
            </label>
            <input id={figmaId} name="url" type="url" required placeholder="https://www.figma.com/design/…" className="min-h-[38px] rounded-full border border-line-ctl bg-surface px-4 font-mono text-small" />
            <Button type="submit" className="self-start">
              Add the link
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** What the next message carries: the chips in the composer. */
export function useAttachments() {
  const [items, setItems] = useState<ChatAttachment[]>([]);
  return {
    items,
    add: (a: ChatAttachment) => setItems((all) => (all.some((x) => x.id === a.id) ? all : [...all, a])),
    remove: (id: string) => setItems((all) => all.filter((x) => x.id !== id)),
    clear: () => setItems([]),
  };
}
