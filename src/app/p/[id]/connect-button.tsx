"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { SimTag } from "@/components/ax/pill";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { SCOPE_LABEL, type Scope } from "@/lib/policies";
import { PROVIDERS, providerAccount, providerName } from "@/lib/providers";
import { connectPart } from "@/server/actions/run";

/**
 * Connect (BL-9), simulated: the service's consent screen (what Architect may do, the account it uses), then Allow
 * connects it and the waiting part works with real data. No real sign-in happens; the dialog says so.
 */
export function ConnectButton({
  itemId,
  provider,
  label,
  variant = "secondary",
  size = "sm",
  disabledReason,
  onDone,
  policy,
}: {
  itemId: string;
  provider: string | null;
  label?: string;
  variant?: "primary" | "secondary";
  size?: "sm" | "md";
  disabledReason?: string;
  onDone?: () => void;
  /** The organisation's app policy here (C-3): who may connect, and what the app may do. */
  policy?: { governance: boolean; connectRefusal: string | null; scopes: Record<string, Scope> };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const name = providerName(provider);
  const what = (provider && PROVIDERS[provider]?.what) ?? `Reads and writes what this part needs in ${name}.`;
  const scope = provider && policy?.governance ? policy.scopes[provider] : undefined;
  return (
    <>
      <Button data-tour-hint="blocker" variant={variant} size={size} disabledReason={disabledReason ?? policy?.connectRefusal ?? undefined} onClick={() => setOpen(true)}>
        {label ?? `Connect ${providerAccount(provider)}`}
      </Button>
      {!disabledReason && policy?.connectRefusal && <span className="text-small text-ink-2">{policy.connectRefusal}</span>}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]" showCloseButton={false}>
          <div className="flex items-center gap-2">
            <DialogTitle className="flex-1 text-sub font-semibold">Connect {name}</DialogTitle>
            <SimTag title="No real sign-in happens in this prototype" />
          </div>
          <DialogDescription className="text-ink-2">Architect is asking your {providerAccount(provider)} for permission to:</DialogDescription>
          <ul className="list-disc pl-5 text-body">
            <li>{what}</li>
            {scope && <li>Your organisation allows {SCOPE_LABEL[scope].toLowerCase()} access, so that&apos;s all Architect asks for.</li>}
            <li>Keep this access until you disconnect it in Connections.</li>
          </ul>
          <p className="text-small text-ink-2">In the real product this opens {name}&apos;s own sign-in. Here, Allow connects it straight away.</p>
          {error && (
            <p role="alert" className="text-small font-semibold text-failed">
              {error}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="quiet" disabledReason={pending ? "Connecting…" : undefined} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabledReason={pending ? "Connecting…" : undefined}
              onClick={() =>
                start(async () => {
                  setError(undefined);
                  const r = await connectPart({ itemId });
                  if (!r.ok) return setError(r.message);
                  setOpen(false);
                  onDone?.();
                  router.refresh();
                })
              }
            >
              {pending ? "Connecting…" : "Allow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
