"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { acceptInvite } from "@/server/actions/members";

export function AcceptButton({ token }: { token: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        className="self-start"
        disabledReason={pending ? "Joining…" : undefined}
        onClick={() =>
          start(async () => {
            // On success the action redirects to Home; it only returns when something's wrong.
            const r = await acceptInvite(token);
            if (r && !r.ok) setError(r.message);
          })
        }
      >
        {pending ? "Joining…" : "Accept and join"}
      </Button>
      {error && (
        <p role="alert" className="text-small font-semibold text-failed">
          {error}
        </p>
      )}
    </div>
  );
}
