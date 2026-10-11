"use client";

import { ToolInitials } from "@/components/ax/list-row";
import { TemplateCard } from "@/components/ax/template-card";
import { useHomePrompt } from "@/lib/home-prompt";
import { STARTERS } from "@/lib/templates";
import { MosaicThumb } from "@/components/ax/MosaicThumb";
import { templateParts } from "@/lib/brand";

const FEATURED = ["support-triage", "account-research", "ask-your-documents"];

/** Three starting points on Home. Picking one fills the prompt above, ready to edit. */
export function IdeaCards() {
  const setPrompt = useHomePrompt((s) => s.setPrompt);
  const ideas = FEATURED.map((id) => STARTERS.find((s) => s.id === id)!);
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {ideas.map((s) => (
        <TemplateCard
          key={s.id}
          icon={s.icon}
          picture={<MosaicThumb seed={s.id} parts={templateParts(s.id, s.credits)} />}
          kind={s.kind === "Prompt" ? undefined : s.kind}
          name={s.name}
          description={s.description}
          footer={
            <span className="flex items-center gap-2 text-ink-2">
              <ToolInitials tools={s.tools} />
              {s.tools.join(", ")}
            </span>
          }
          onPick={() => {
            setPrompt(s.prompt);
            const box = document.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]');
            box?.scrollIntoView({ behavior: "smooth", block: "center" });
            box?.focus();
          }}
        />
      ))}
    </div>
  );
}
