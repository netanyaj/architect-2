"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ax/button";
import { switchWorkspace } from "@/server/actions/members";

/** The project lives in another workspace the person belongs to: switch there first, then it opens. */
export function SwitchWorkspaceCard({ name, workspace }: { name: string; workspace: { id: string; label: string } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4">
      <div className="flex w-full max-w-[440px] flex-col gap-4 rounded-pane border border-line bg-surface p-8 shadow-pane">
        <h1 className="text-heading font-[650]">{name} is in {workspace.label}</h1>
        <p className="text-ink-2">Switch to that workspace to open it. Your own workspace stays as it is.</p>
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabledReason={pending ? "Switching…" : undefined}
            onClick={() =>
              start(async () => {
                const r = await switchWorkspace(workspace.id);
                if (r.ok) router.refresh();
              })
            }
          >
            {pending ? "Switching…" : `Switch to ${workspace.label}`}
          </Button>
          <Button variant="quiet" href="/projects">
            Back to projects
          </Button>
        </div>
      </div>
    </main>
  );
}
