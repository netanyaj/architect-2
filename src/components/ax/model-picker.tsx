"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AUTO, AUTO_LABEL, AUTO_NOTE, MODEL_COST_WORDS, MODEL_LABEL, type ModelChoice, type ModelOption, type ModelPick } from "@/lib/models";
import { MODEL_NOT_ALLOWED } from "@/lib/policies";
import { cn } from "@/lib/utils";
import { Icon } from "./icon";
import { SimTag } from "./pill";

const SIMULATED_NOTE = "Answered by Gemini in this prototype";

/** Shown where a model is picked when the project or agent is on a model the policy no longer allows (C-2). */
export function ModelNotAllowed({ onSwitch, className }: { onSwitch: () => void; className?: string }) {
  return (
    <p role="status" className={cn("flex flex-wrap items-center gap-1.5 text-small font-semibold text-attention", className)}>
      {MODEL_NOT_ALLOWED} ·
      <button type="button" onClick={onSwitch} className="min-h-6 underline underline-offset-2">
        Switch
      </button>
    </p>
  );
}

/**
 * The model pill (BL-3, M5.8): Auto first ("Picks a model for each step") where `auto` is on, then the models this
 * workspace allows, each with its relative cost in words, never numbers. A model without a key here is answered by
 * Gemini, and says so with the Simulated tag. Models the workspace blocks stay in the list, disabled, with the reason.
 */
export function ModelPicker<V extends ModelPick = ModelChoice>({
  value,
  options,
  blocked = [],
  auto = false,
  autoResolves,
  onChange,
  disabledReason,
  compact = false,
  open,
  onOpenChange,
}: {
  value: V;
  options: ModelOption[];
  /** Blocked by the workspace's policy: listed, disabled. */
  blocked?: ModelOption[];
  /** Offer Auto first (projects and Home; not agents, which run on one Studio model). */
  auto?: boolean;
  /** The model Auto uses in this prototype, for its tooltip. */
  autoResolves?: string;
  onChange: (choice: V) => void;
  disabledReason?: string;
  compact?: boolean;
  /** Controlled open state, so "This model is no longer allowed · Switch" can open the menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isAuto = value === AUTO;
  const current = isAuto ? undefined : options.find((o) => o.choice === value);
  const full = isAuto ? AUTO_LABEL : (current?.label ?? MODEL_LABEL[value as ModelChoice]);
  const label = compact ? full.replace(" (free)", "").replace("Claude ", "") : full;
  const autoTitle = `${AUTO_NOTE}.${autoResolves ? ` In this prototype every step uses ${autoResolves}.` : ""}`;
  const allowedNow = isAuto || Boolean(current);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label={`Model: ${full}${current?.simulated ? ` (simulated, ${SIMULATED_NOTE.toLowerCase()})` : ""}${allowedNow ? "" : " (no longer allowed)"}. Change`}
        title={disabledReason ?? (isAuto ? autoTitle : current?.simulated ? SIMULATED_NOTE : MODEL_COST_WORDS[value as ModelChoice])}
        disabled={Boolean(disabledReason)}
        className={cn(
          "inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full border border-line bg-tray px-3 text-body font-[550] whitespace-nowrap text-ink hover:bg-selected",
          disabledReason && "cursor-not-allowed text-ink-3 hover:bg-tray",
          !allowedNow && "border-attention text-attention",
        )}
      >
        <span className="truncate">{label}</span>
        {current?.simulated && <span className="rounded-full border border-dashed border-line-ctl px-1.5 text-small leading-4 text-ink-2">Sim</span>}
        <Icon name="chevronDown" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={12} className="w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        {auto && (
          <DropdownMenuItem onSelect={() => !isAuto && onChange(AUTO as V)} className="flex min-h-11 items-center gap-2.5 rounded-tile px-2.5" title={autoTitle}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{AUTO_LABEL}</span>
              <span className="text-small text-ink-2">{AUTO_NOTE}</span>
            </span>
            {isAuto && <Icon name="check" size="sm" aria-label="Current" />}
          </DropdownMenuItem>
        )}
        <DropdownMenuLabel className="px-2.5 text-small font-[650] text-ink-3">{auto ? "Or pick one" : "Models allowed in this workspace"}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.choice}
            onSelect={() => o.choice !== value && onChange(o.choice as V)}
            className="flex min-h-11 items-center gap-2.5 rounded-tile px-2.5"
            title={o.simulated ? SIMULATED_NOTE : undefined}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{o.label}</span>
              <span className="text-small text-ink-2">{MODEL_COST_WORDS[o.choice]}</span>
              {o.simulated && <span className="text-small text-ink-2">{SIMULATED_NOTE}</span>}
            </span>
            {o.simulated && <SimTag title={SIMULATED_NOTE} />}
            {o.choice === value && <Icon name="check" size="sm" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
        {blocked.map((o) => (
          <DropdownMenuItem key={o.choice} disabled title="Blocked by your workspace" className="flex min-h-11 items-center gap-2.5 rounded-tile px-2.5 opacity-100">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold text-ink-3">{o.label}</span>
              <span className="text-small text-ink-2">Blocked by your workspace</span>
            </span>
            <Icon name="lock" size="sm" className="text-ink-3" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
