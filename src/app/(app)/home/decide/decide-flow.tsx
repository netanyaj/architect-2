"use client";

import { useId, useState, useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { Icon } from "@/components/ax/icon";
import { ToolInitials } from "@/components/ax/list-row";
import { SimTag, Tag } from "@/components/ax/pill";
import { StatusMark } from "@/components/ax/status-mark";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { suggestIdeas, type Idea } from "@/server/actions/decide";
import { startProject } from "@/server/actions/projects";

type Step = 1 | 2 | 3;

/**
 * The AI Consultant (BL-2, screen 14): what you do, what takes your time and which tools you use, then three ideas.
 * The ideas come from the model through the gateway; picking one writes its plan, and nothing is built before Build.
 */
export function DecideFlow({ canStart }: { canStart: boolean }) {
  const ids = { role: useId(), time: useId() };
  const [step, setStep] = useState<Step>(1);
  const [role, setRole] = useState("");
  const [timeSink, setTimeSink] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [seen, setSeen] = useState<string[]>([]);
  const [chosen, setChosen] = useState(0);
  const [model, setModel] = useState<{ name: string; simulated: boolean } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();

  const ask = (avoid: string[]) =>
    start(async () => {
      setError(undefined);
      const r = await suggestIdeas({ role, timeSink, tools, avoid });
      if (!r.ok) return setError(r.message);
      setIdeas(r.ideas);
      setSeen([...avoid, ...r.ideas.map((i) => i.title)]);
      setChosen(0);
      setModel({ name: r.model, simulated: r.simulated });
      setStep(3);
    });

  const write = () =>
    start(async () => {
      setError(undefined);
      // Opens the new project, where the plan is written; it only returns when something's wrong.
      const r = await startProject({ prompt: ideas[chosen].prompt });
      if (r && !r.ok) setError(r.message);
    });

  const field = "w-full rounded-[12px] border border-line-ctl bg-surface px-3.5 py-2.5 text-body";
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 px-8 pt-10 pb-12 max-sm:px-4">
      <div className="flex items-center gap-3">
        {step === 1 ? (
          <TextLink href="/home" className="flex items-center gap-1">
            <Icon name="chevronLeft" size="sm" /> Back
          </TextLink>
        ) : (
          <TextLink onClick={() => setStep(step === 3 ? 2 : 1)} className="flex items-center gap-1">
            <Icon name="chevronLeft" size="sm" /> Back
          </TextLink>
        )}
        <span className="ml-auto text-small text-ink-2">Step {step} of 3 · about 2 minutes in total</span>
      </div>

      {step === 1 && (
        <section aria-labelledby="q1" className="flex flex-col gap-4">
          <h1 id="q1" className="text-title font-[650]">
            What do you do?
          </h1>
          <p className="text-ink-2">Three quick questions, then three things worth building. Nothing is built, or charged, until you choose one and click Build.</p>
          <label htmlFor={ids.role} className="text-small font-semibold text-ink-2">
            Your role
          </label>
          <input id={ids.role} value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} placeholder="Sales operations lead" className={field} />
          <Button variant="primary" className="self-start" disabledReason={role.trim().length < 2 ? "Say what you do first." : undefined} onClick={() => setStep(2)}>
            Next
          </Button>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="q2" className="flex flex-col gap-4">
          <h1 id="q2" className="text-title font-[650]">
            What takes your time, and what do you use?
          </h1>
          <label htmlFor={ids.time} className="text-small font-semibold text-ink-2">
            What takes up your time every week
          </label>
          <textarea id={ids.time} value={timeSink} onChange={(e) => setTimeSink(e.target.value)} maxLength={300} rows={3} placeholder="Meeting prep takes about 4 hours a week" className={field} />
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-small font-semibold text-ink-2">The tools you use</legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PROVIDERS).map(([id, p]) => {
                const on = tools.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTools(on ? tools.filter((t) => t !== id) : [...tools, id])}
                    className={cn("min-h-8 rounded-full border px-3.5 font-[550]", on ? "border-ink bg-selected" : "border-line-ctl bg-surface hover:bg-selected")}
                  >
                    {p.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="font-semibold text-failed">
              {error}
            </p>
          )}
          <Button variant="primary" className="self-start" disabledReason={pending ? "Thinking of ideas…" : timeSink.trim().length < 3 ? "Say what takes your time first." : undefined} onClick={() => ask([])}>
            {pending ? "Thinking of ideas…" : "Show me three ideas"}
          </Button>
        </section>
      )}

      {step === 3 && (
        <section aria-labelledby="ideas" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 id="ideas" className="text-title font-[650]">
              Here are three things worth building
            </h1>
            <p className="text-ink-2">Picked from what you told me. You&apos;ll still see the full plan and its cost before anything is built.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-small">
            <span className="font-semibold text-ink-2">You said</span>
            <Tag>{role}</Tag>
            <Tag className="max-w-[260px] truncate">{timeSink}</Tag>
            {tools.length > 0 && <Tag>{tools.map((t) => PROVIDERS[t]?.name ?? t).join(", ")}</Tag>}
            <TextLink onClick={() => setStep(1)}>Change answers</TextLink>
          </div>
          <div role="radiogroup" aria-label="Ideas" className="flex flex-col gap-2.5">
            {ideas.map((idea, i) => (
              <button
                key={idea.title}
                type="button"
                role="radio"
                aria-checked={chosen === i}
                onClick={() => setChosen(i)}
                className={cn("flex items-start gap-3.5 rounded-card border border-line bg-surface px-4 py-3.5 text-left hover:border-line-ctl", chosen === i && "border-2 border-ink px-[15px] py-[13px]")}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <strong className="font-[650]">{idea.title}</strong>
                  <span className="text-ink-2">{idea.line}</span>
                  <span className="flex flex-wrap items-center gap-2 text-small text-ink-2">
                    <ToolInitials tools={idea.tools.map((t) => PROVIDERS[t]?.tool ?? t)} />
                    Saves about {idea.hoursSaved} h a week (an estimate)
                  </span>
                </span>
                {chosen === i && <StatusMark status="works" label="Chosen" />}
              </button>
            ))}
          </div>
          {model && (
            <p className="flex flex-wrap items-center gap-2 text-small text-ink-2">
              Ideas by {model.name}. {model.simulated && <SimTag title="This model has no key here, so Gemini answered in its place." />}
            </p>
          )}
          {error && (
            <p role="alert" className="font-semibold text-failed">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="quiet" disabledReason={pending ? "Thinking of ideas…" : undefined} onClick={() => ask(seen)}>
              Show 3 different ideas
            </Button>
            <span className="flex-1" />
            <Button variant="primary" iconAfter="chevronRight" disabledReason={!canStart ? "Viewers can't start projects." : pending ? "Opening the project…" : undefined} onClick={write}>
              Write the plan for this
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
