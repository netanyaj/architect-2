"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Composer } from "@/components/ax/composer";
import { Pill } from "@/components/ax/pill";
import { loginUrl, PENDING_PROMPT_KEY } from "@/lib/auth-paths";

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Home's hero: greeting, heading and the composer. Keeps a typed prompt through sign-in. */
export function HomeComposer({ signedIn, firstName }: { signedIn: boolean; firstName?: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [talkFirst, setTalkFirst] = useState(false);
  const [hello, setHello] = useState<string | null>(null);

  useEffect(() => {
    // Browser-only values, read after mount: the local time of day and a prompt kept through sign-in.
    /* eslint-disable react-hooks/set-state-in-effect */
    setHello(greeting(new Date()));
    try {
      const kept = sessionStorage.getItem(PENDING_PROMPT_KEY);
      if (kept) {
        setPrompt(kept);
        if (signedIn) sessionStorage.removeItem(PENDING_PROMPT_KEY);
      }
    } catch {
      // Storage blocked: nothing to restore.
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [signedIn]);

  const submit = () => {
    if (!signedIn) {
      try {
        sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
      } catch {
        // Storage blocked: they'll retype after signing in.
      }
      router.push(loginUrl("/home"));
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2.5">
        <span className="min-h-6 text-sub font-medium text-ink-2">
          {hello && (firstName ? `${hello}, ${firstName}` : hello)}
        </span>
        <h1 className="text-display font-[650] tracking-[-0.03em] max-sm:text-title">What should we build?</h1>
        <p className="text-sub text-ink-2">Describe it once. You’ll see the full plan and what it costs before anything is built.</p>
      </div>
      <Composer
        variant="home"
        value={prompt}
        onChange={setPrompt}
        onSubmit={submit}
        talkFirst={talkFirst}
        onTalkFirstChange={setTalkFirst}
        placeholder="Describe the app you want. For example: before each meeting, send me a Slack brief with each attendee’s last email."
        label="Describe your app"
        submitDisabledReason={signedIn && prompt.trim() ? "Writing the plan arrives with the next build step (M2)" : undefined}
        modelPicker={<Pill soft iconAfter="chevronDown">Gemini</Pill>}
        contextPills={
          <>
            <Pill icon="plus">Add files, agents or tools</Pill>
            <Pill icon="repo">Import a repo</Pill>
            <Pill icon="grid">Templates and prompts</Pill>
            <Pill icon="sparkle">Help me decide</Pill>
          </>
        }
      />
    </>
  );
}
