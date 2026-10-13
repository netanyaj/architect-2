"use client";

import { Button } from "@/components/ax/button";
import { StageBanner } from "@/components/ax/stage-banner";
import { useUi } from "@/lib/ui-store";
import type { ChatBusy } from "@/server/actions/chat";
import type { ProjectWorkspace } from "@/server/project";

/** What the banner says about why the model is busy. */
export function busyLine(busy: ChatBusy): string {
  return busy === "slow"
    ? "The free model didn't finish in time."
    : busy === "demand"
      ? "The model has too many requests right now (high demand)."
      : "The free model can't take more requests right now.";
}

/**
 * The paused banner for chat and Fix with AI, as the plan shows it: the model is busy (its limit, high demand or too
 * slow), what's kept, and Switch model. Switch model asks first, like the composer's picker.
 */
export function ModelBusyBanner({ project, busy, kept, className }: { project: ProjectWorkspace; busy: ChatBusy; kept: string; className?: string }) {
  const requestModel = useUi((s) => s.requestModel);
  const label = project.models.find((m) => m.choice === project.model)?.label ?? project.model;
  const others = project.models.filter((m) => m.choice !== project.model);
  const switchTo = others.find((m) => !m.simulated) ?? others[0];
  return (
    <StageBanner
      kind="paused"
      className={className}
      title={busy === "slow" ? `${label} is taking too long` : `${label} is busy right now`}
      actions={switchTo && <Button onClick={() => requestModel(switchTo.choice)}>Switch model</Button>}
    >
      {busyLine(busy)} {kept} Nothing was changed or charged. {switchTo ? `Switch to ${switchTo.label}, or try again in a minute.` : "Try again in a minute."}
    </StageBanner>
  );
}
