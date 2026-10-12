"use client";

import { useEffect, useSyncExternalStore } from "react";
import { DEMO_SETUP_COOKIE } from "@/lib/demo-setup";
import { BuildLoader } from "./BuildLoader";

/**
 * Try the demo (M6 round 4): the first demo can take over 15 seconds while its workspace is seeded and Home loads.
 * One clear state covers the whole wait, from the click to Home.
 */
export function DemoSetupOverlay() {
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-canvas p-6">
      <BuildLoader step="Setting up your demo workspace…" seed="demo">
        <p className="max-w-[360px] text-center text-ink-2">Your own copy of Acme Ops, with its projects, approvals and audit log. It takes a few seconds the first time.</p>
      </BuildLoader>
    </div>
  );
}

const noSubscribe = () => () => {};

/** In the app's loading state: the demo overlay while a demo is still being set up, nothing otherwise. */
export function DemoSetupWhileLoading() {
  // Read once in the browser; the server render shows the usual skeleton.
  const setting = useSyncExternalStore(
    noSubscribe,
    () => document.cookie.split("; ").includes(`${DEMO_SETUP_COOKIE}=1`),
    () => false,
  );
  return setting ? <DemoSetupOverlay /> : null;
}

/** On Home: the demo is ready, so later page loads show the usual skeleton. */
export function DemoSetupDone() {
  useEffect(() => {
    document.cookie = `${DEMO_SETUP_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }, []);
  return null;
}
