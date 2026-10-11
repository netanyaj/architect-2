"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button, TextLink } from "@/components/ax/button";
import { useHomePrompt } from "@/lib/home-prompt";
import { switchWorkspace } from "@/server/actions/members";

/** An empty Personal workspace (0021): governance off, so a project goes live in one step. Where to start. */
export function PersonalStart({ demoId }: { demoId: string | null }) {
  const router = useRouter();
  const { setTemplatesOpen } = useHomePrompt();
  const [pending, start] = useTransition();
  return (
    <section aria-labelledby="personal" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
      <h2 id="personal" className="text-sub font-semibold">
        Personal workspace · governance off · go live in one step
      </h2>
      <p className="text-ink-2">Nothing here yet. Describe an app above, or start from one of these.</p>
      <div className="flex flex-wrap gap-2">
        <Button icon="grid" onClick={() => setTemplatesOpen(true)}>
          Templates and prompts
        </Button>
        <Button icon="sparkle" href="/home/decide">
          Help me decide
        </Button>
      </div>
      {demoId && (
        <TextLink
          className="self-start"
          aria-disabled={pending || undefined}
          onClick={() =>
            start(async () => {
              const r = await switchWorkspace(demoId);
              if (r.ok) router.refresh();
            })
          }
        >
          See a team workspace → Acme Ops (Enterprise)
        </TextLink>
      )}
    </section>
  );
}
