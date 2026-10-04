"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserDb } from "@/lib/db";
import type { ModelChoice } from "@/lib/models";
import type { PlanEvent, PlanItem } from "@/server/blueprint/write-plan";

export type WriterState =
  | { phase: "idle" }
  | { phase: "writing"; items: PlanItem[]; model?: { label: string; simulated: boolean }; retrying: boolean }
  | { phase: "failed"; kind: "rate_limited" | "invalid" | "unavailable" | "refused"; message: string; items: PlanItem[] };

/** Reads newline-delimited JSON events from the plan route. */
async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<PlanEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as PlanEvent;
    }
  }
}

/**
 * Writes the plan through POST /api/blueprint and shows parts as they stream in. When the page opens on a plan
 * that's already being written elsewhere, it follows the saved parts through Realtime instead.
 */
export function usePlanWriter(opts: { projectId: string; writingBlueprintId: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<WriterState>({ phase: "idle" });
  const inFlight = useRef(false);

  const write = useCallback(
    async (input: { model?: ModelChoice; prompt?: string } = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ phase: "writing", items: [], retrying: false });
      try {
        const res = await fetch("/api/blueprint", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: opts.projectId, ...input }),
        });
        if (!res.ok || !res.body) {
          const { message } = await res.json().catch(() => ({ message: "The plan couldn't be started. Try again." }));
          // Another tab is already writing it: follow along instead.
          if (res.status === 409) router.refresh();
          setState({ phase: "failed", kind: "refused", message, items: [] });
          return;
        }
        for await (const e of readEvents(res.body)) {
          setState((s) => {
            const items = s.phase === "idle" ? [] : s.items;
            switch (e.type) {
              case "started":
                return { phase: "writing", items: [], model: e.model, retrying: false };
              case "item":
                return { ...(s as Extract<WriterState, { phase: "writing" }>), items: [...items.filter((i) => i.key !== e.item.key), e.item] };
              case "reset":
                return { phase: "writing", items: [], retrying: true, model: s.phase === "writing" ? s.model : undefined };
              case "error":
                return { phase: "failed", kind: e.kind, message: e.message, items };
              case "done":
                // The saved plan (questions, defaults, totals) comes in with the refresh below.
                return { phase: "idle" };
              default:
                return s;
            }
          });
          if (e.type === "done" || e.type === "error") router.refresh();
        }
      } catch {
        setState((s) => ({ phase: "failed", kind: "unavailable", message: "The connection dropped. The parts written so far are kept.", items: s.phase === "idle" ? [] : s.items }));
        router.refresh();
      } finally {
        inFlight.current = false;
      }
    },
    [opts.projectId, router],
  );

  // Opened on a plan that's being written elsewhere (or this tab reloaded): follow it through Realtime.
  useEffect(() => {
    if (!opts.writingBlueprintId || inFlight.current) return;
    const db = createBrowserDb();
    const channel = db
      .channel(`plan-${opts.writingBlueprintId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "items", filter: `blueprint_id=eq.${opts.writingBlueprintId}` }, () => router.refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "blueprints", filter: `id=eq.${opts.writingBlueprintId}` }, (payload) => {
        if ((payload.new as { generation?: string }).generation !== "writing") router.refresh();
      })
      .subscribe();
    return () => {
      db.removeChannel(channel);
    };
  }, [opts.writingBlueprintId, router]);

  return { state, write };
}
