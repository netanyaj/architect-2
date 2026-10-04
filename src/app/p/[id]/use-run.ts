"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createBrowserDb } from "@/lib/db";
import { replay, type LiveRun, type RunInfo } from "@/lib/sim/replay";
import { settleRunNow } from "@/server/actions/run";

/**
 * Plays the project's latest run on the clock (SIMULATOR step 2): every viewer computes the same state from the
 * stored events and the time now. The first browser to reach the end settles it (step 3). Realtime brings in runs
 * started elsewhere, and the final statuses once another tab settles.
 */
export function useRun(projectId: string, run: RunInfo | null, serverNow: string): LiveRun {
  const router = useRouter();
  // The database's clock is the run's clock: offset this browser's clock to it. The first render uses the
  // server's time on both sides, so hydration matches; the timer then moves on from there.
  const offset = useRef(0);
  useEffect(() => {
    offset.current = Date.parse(serverNow) - Date.now();
  }, [serverNow]);
  const [now, setNow] = useState(() => Date.parse(serverNow));
  const live = useMemo(() => replay(run, now), [run, now]);

  // Tick to the next event while the run plays (at least once a second, for the time left).
  useEffect(() => {
    if (!live.playing && !live.due) return;
    const wait = Math.min(1000, Math.max(50, live.nextInMs ?? 1000));
    const t = setTimeout(() => setNow(Date.now() + offset.current), wait);
    return () => clearTimeout(t);
  }, [live.playing, live.due, live.nextInMs, now]);

  // Settle once it's due; the database does it only once, whoever asks. If it isn't quite due by the database's
  // clock yet, ask again shortly.
  const settling = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!live.due || !run || settling.current === run.id) return;
    settling.current = run.id;
    void settleRunNow({ runId: run.id }).then((r) => {
      if (r.ok && r.status === "running") {
        setTimeout(() => {
          settling.current = null;
          setRetry((n) => n + 1);
        }, 2000);
      } else router.refresh();
    });
  }, [live.due, run, router, retry]);

  // New runs, settled runs and parts changed by another tab or person.
  useEffect(() => {
    const db = createBrowserDb();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const channel = db
      .channel(`runs-${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "runs", filter: `project_id=eq.${projectId}` }, refresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "items", filter: `project_id=eq.${projectId}` }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      db.removeChannel(channel);
    };
  }, [projectId, router]);

  return live;
}
