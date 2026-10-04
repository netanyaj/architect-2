"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Composer } from "@/components/ax/composer";
import { ModelPicker } from "@/components/ax/model-picker";
import { Pill } from "@/components/ax/pill";
import { TemplatesDialog } from "@/components/ax/templates-dialog";
import { loginUrl, PENDING_PROMPT_KEY } from "@/lib/auth-paths";
import { useHomePrompt } from "@/lib/home-prompt";
import type { ModelChoice, ModelOption } from "@/lib/models";
import { startProject } from "@/server/actions/projects";

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/**
 * Home's hero: greeting, heading and the composer.
 * Signed out, Write the plan keeps the prompt through sign-in. Signed in, it creates the project and opens it.
 */
export function HomeComposer({
  signedIn,
  firstName,
  startBlockedReason,
  initialPrompt,
  models,
}: {
  signedIn: boolean;
  firstName?: string;
  /** Why this person can't start a project (Viewers). */
  startBlockedReason?: string;
  /** From a Marketplace pick (?starter=). A prompt kept through sign-in wins. */
  initialPrompt?: string;
  /** The models this workspace allows (all of them when signed out). */
  models: ModelOption[];
}) {
  const router = useRouter();
  const { prompt, setPrompt, templatesOpen, setTemplatesOpen } = useHomePrompt();
  const [talkFirst, setTalkFirst] = useState(false);
  const [model, setModel] = useState<ModelChoice>(models.find((m) => m.choice === "gemini")?.choice ?? models[0]?.choice ?? "gemini");
  const [hello, setHello] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  useEffect(() => {
    // Browser-only values, read after mount: the local time of day and a prompt kept through sign-in.
    /* eslint-disable react-hooks/set-state-in-effect */
    setHello(greeting(new Date()));
    try {
      const kept = sessionStorage.getItem(PENDING_PROMPT_KEY);
      if (kept) {
        setPrompt(kept);
        if (signedIn) sessionStorage.removeItem(PENDING_PROMPT_KEY);
      } else if (initialPrompt) {
        setPrompt(initialPrompt);
      }
    } catch {
      if (initialPrompt) setPrompt(initialPrompt);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [signedIn, setPrompt, initialPrompt]);

  const submit = (text: string) => {
    setError(undefined);
    if (!signedIn) {
      try {
        sessionStorage.setItem(PENDING_PROMPT_KEY, text);
      } catch {
        // Storage blocked: they'll retype after signing in.
      }
      router.push(loginUrl("/home"));
      return;
    }
    start(async () => {
      // On success the action opens the new project; it only returns when something's wrong.
      const r = await startProject({ prompt: text, talkFirst, model });
      if (r && !r.ok) setError(r.message);
    });
  };

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <span className="min-h-6 text-sub font-medium text-ink-2">{hello && (firstName ? `${hello}, ${firstName}` : hello)}</span>
        <h1 className="text-display font-[650] tracking-[-0.03em] max-sm:text-title">What should we build?</h1>
        <p className="text-sub text-ink-2">Describe it once. You’ll see the full plan and what it costs before anything is built.</p>
      </div>
      <div className="flex flex-col gap-2">
        <Composer
          variant="home"
          value={prompt}
          onChange={setPrompt}
          onSubmit={submit}
          talkFirst={talkFirst}
          onTalkFirstChange={setTalkFirst}
          pending={pending}
          placeholder="Describe the app you want. For example: before each meeting, send me a Slack brief with each attendee’s last email."
          label="Describe your app"
          submitDisabledReason={signedIn ? startBlockedReason : undefined}
          modelPicker={<ModelPicker value={model} options={models} onChange={setModel} />}
          contextPills={
            <>
              <Pill icon="plus" disabledReason="Adding files, agents and tools comes with plan writing (M2).">
                Add files, agents or tools
              </Pill>
              <Pill icon="repo" disabledReason="Importing a repo comes in M4.">
                Import a repo
              </Pill>
              <Pill icon="grid" onClick={() => setTemplatesOpen(true)}>
                Templates and prompts
              </Pill>
              <Pill icon="sparkle" disabledReason="Help me decide comes with plan writing (M2).">
                Help me decide
              </Pill>
            </>
          }
        />
        {signedIn && startBlockedReason && <p className="text-small text-ink-2">{startBlockedReason}</p>}
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
      </div>
      <TemplatesDialog
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onPick={(s) => {
          setPrompt(s.prompt);
          setTemplatesOpen(false);
          requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[name="prompt"]')?.focus());
        }}
      />
    </>
  );
}
