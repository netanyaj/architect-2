"use client";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MODEL_LABEL, MODEL_NOTE, type ModelChoice, type ModelOption } from "@/lib/models";
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
 * The model pill (BL-3): only the models this workspace allows. A model without a key here is answered by Gemini,
 * and says so with the Simulated tag. Never hide that a model is simulated.
 */
export function ModelPicker({
  value,
  options,
  onChange,
  disabledReason,
  compact = false,
  open,
  onOpenChange,
}: {
  value: ModelChoice;
  options: ModelOption[];
  onChange: (choice: ModelChoice) => void;
  disabledReason?: string;
  compact?: boolean;
  /** Controlled open state, so "This model is no longer allowed · Switch" can open the menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const current = options.find((o) => o.choice === value);
  const full = current?.label ?? MODEL_LABEL[value];
  const label = compact ? full.replace(" (free)", "").replace("Claude ", "") : full;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label={`Model: ${full}${current?.simulated ? ` (simulated, ${SIMULATED_NOTE.toLowerCase()})` : ""}${current ? "" : " (no longer allowed)"}. Change`}
        title={disabledReason ?? (current?.simulated ? SIMULATED_NOTE : MODEL_NOTE[value])}
        disabled={Boolean(disabledReason)}
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-tray px-3 text-body font-[550] whitespace-nowrap text-ink hover:bg-selected",
          disabledReason && "cursor-not-allowed text-ink-3 hover:bg-tray",
          !current && "border-attention text-attention",
        )}
      >
        {label}
        {current?.simulated && <span className="rounded-full border border-dashed border-line-ctl px-1.5 text-small leading-4 text-ink-2">Sim</span>}
        <Icon name="chevronDown" size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 rounded-card border border-line bg-surface p-1.5 shadow-pop">
        <DropdownMenuLabel className="px-2.5 text-small font-[650] text-ink-3">Models allowed in this workspace</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuItem
            key={o.choice}
            onSelect={() => o.choice !== value && onChange(o.choice)}
            className="flex min-h-11 items-center gap-2.5 rounded-tile px-2.5"
            title={o.simulated ? SIMULATED_NOTE : undefined}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{o.label}</span>
              {MODEL_NOTE[o.choice] && <span className="text-small text-ink-2">{MODEL_NOTE[o.choice]}</span>}
              {o.simulated && <span className="text-small text-ink-2">{SIMULATED_NOTE}</span>}
            </span>
            {o.simulated && <SimTag title={SIMULATED_NOTE} />}
            {o.choice === value && <Icon name="check" size="sm" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
