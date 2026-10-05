"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Toggle } from "@/components/ax/toggle";
import { setGovernance } from "@/server/actions/launch";

/**
 * The workspace's governance setting. On: Test → Team → Live, with approval for Builders (and the governance pages).
 * Off: Test → Go live, the team version optional. Owners and Admins change it.
 */
export function GovernanceSection({ on, canEdit }: { on: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <section aria-labelledby="governance" className="flex flex-col gap-3">
      <h2 id="governance" className="text-heading font-[650]">
        Governance
      </h2>
      <div className="flex flex-col gap-2 rounded-card border border-line p-4">
        <Toggle
          checked={on}
          onCheckedChange={(next) =>
            start(async () => {
              setError(undefined);
              const r = await setGovernance({ on: next });
              if (!r.ok) setError(r.message);
              router.refresh();
            })
          }
          label="Approvals and a team version before Live"
          consequence={
            on
              ? "On: apps go Test → Team → Live, and a Builder's Go live waits for an Owner or Admin. Policies and the approval queue apply."
              : "Off: anyone who can build goes live straight from the test version; sharing a team version first is optional."
          }
          disabledReason={!canEdit ? "Only Owners and Admins can change governance." : pending ? "Saving…" : undefined}
        />
        {error && (
          <p role="alert" className="text-small font-semibold text-failed">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
