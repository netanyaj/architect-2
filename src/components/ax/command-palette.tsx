"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ax/icon";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { paletteResults, type PaletteItem } from "@/lib/palette";
import { useUi } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { switchWorkspace } from "@/server/actions/members";
import { searchIndex, type SearchIndex } from "@/server/actions/search";
import { useTourGuide } from "./tour-guide";

const ICON: Record<PaletteItem["group"], IconName> = {
  Actions: "sparkle",
  Projects: "projects",
  Agents: "agent",
  Connections: "connections",
  Pages: "file",
  Workspaces: "switcher",
};

/**
 * ⌘K / Ctrl K (M5.10): search projects, agents, connections and pages, and run a few actions. Keyboard first: type,
 * ↑ ↓ to move, Enter to open, Esc to close. Results are grouped. Also opened by Search at the top of the side nav.
 */
export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.openPalette);
  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string>();
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const guide = useTourGuide();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!useUi.getState().paletteOpen);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  // Fresh each time it opens: projects and agents change.
  useEffect(() => {
    if (!open) return;
    let stale = false;
    void searchIndex()
      .then((i) => !stale && setIndex(i))
      .catch(() => !stale && setError("Search couldn't load. Try again."));
    return () => {
      stale = true;
    };
  }, [open]);

  const projectId = /^\/p\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null;
  const results = useMemo(() => (index ? paletteResults(index, query, { projectId, tourAvailable: guide.available }) : []), [index, query, projectId, guide.available]);
  const close = () => {
    setOpen(false);
    setQuery("");
    setActive(0);
    setError(undefined);
  };
  const run = async (item: PaletteItem) => {
    if (item.disabled) return;
    if (item.fill) {
      setQuery(item.fill);
      setActive(0);
      return;
    }
    if (item.tour) {
      close();
      await guide.take();
      return;
    }
    if (item.workspaceId) {
      const r = await switchWorkspace(item.workspaceId);
      if (!r.ok) return setError(r.message);
      close();
      router.push("/home");
      router.refresh();
      return;
    }
    close();
    if (item.href) router.push(item.href);
  };
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const groups = [...new Set(results.map((r) => r.group))];
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 overflow-hidden rounded-pane border border-line bg-surface p-0 shadow-pop sm:max-w-[600px]">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search projects, agents, connections and pages, or run an action. Use the arrow keys and Enter.</DialogDescription>
        {/* The row shows focus (a focus-colour line), so the input's own outline isn't drawn inside it. */}
        <div className="flex items-center gap-2.5 border-b border-line px-4 focus-within:shadow-[inset_0_-2px_0_var(--focus)]">
          <Icon name="search" size="sm" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-label="Search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && results[active]) {
                e.preventDefault();
                void run(results[active]);
              }
            }}
            placeholder="Search projects, agents, connections and pages"
            className="min-h-12 flex-1 bg-transparent text-body text-ink outline-none! placeholder:text-ink-3"
          />
          <kbd className="rounded-[6px] border border-line px-1.5 font-sans text-small text-ink-2">Esc</kbd>
        </div>
        <div ref={list} id={listId} role="listbox" aria-label="Results" className="max-h-[min(60dvh,440px)] overflow-auto p-1.5">
          {!index && !error && <p className="px-3 py-2.5 text-ink-2">Loading…</p>}
          {error && (
            <p role="alert" className="px-3 py-2.5 font-semibold text-failed">
              {error}
            </p>
          )}
          {index && !results.length && <p className="px-3 py-2.5 text-ink-2">Nothing matches “{query}”.</p>}
          {groups.map((g) => (
            <div key={g} role="group" aria-label={g} className="pb-1">
              <div className="px-3 pt-2 pb-1 text-small font-[650] text-ink-3">{g}</div>
              {results.map((r, i) =>
                r.group !== g ? null : (
                  <div
                    key={r.id}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={r.disabled || undefined}
                    onMouseMove={() => setActive(i)}
                    onClick={() => void run(r)}
                    className={cn("flex min-h-10 cursor-pointer items-center gap-2.5 rounded-tile px-3", i === active && "bg-selected", r.disabled && "cursor-not-allowed text-ink-3")}
                  >
                    <Icon name={ICON[r.group]} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-[550]">{r.label}</span>
                    {r.hint && <span className="flex-none truncate text-small text-ink-2">{r.hint}</span>}
                  </div>
                ),
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-small text-ink-2">
          <span>↑ ↓ to move</span>
          <span>Enter to open</span>
          <span className="ml-auto">⌘K or Ctrl K anywhere</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
