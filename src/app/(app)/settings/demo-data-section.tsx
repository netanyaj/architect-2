"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ax/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { resetDemoData } from "@/server/actions/members";

/** Owner only: put the seeded Acme Ops back the way it started. Asks first. */
export function DemoDataSection({ workspaceName }: { workspaceName: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  const reset = () =>
    start(async () => {
      const r = await resetDemoData();
      setOpen(false);
      setMessage(r.ok ? { ok: true, text: "Demo data is back to how it started." } : { ok: false, text: r.message });
    });

  return (
    <section aria-labelledby="demo" className="flex flex-col gap-3">
      <h2 id="demo" className="text-heading font-[650]">
        Demo data
      </h2>
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-line p-4">
        <p className="min-w-[240px] flex-1 text-ink-2">
          Puts {workspaceName}&apos;s projects, connections, approvals and usage back to the start of the demo. People, invites
          and support tickets are kept.
        </p>
        <Button onClick={() => setOpen(true)}>Reset demo data</Button>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "text-small text-ink-2" : "text-small font-semibold text-failed"}>
          {message.text}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-pane border border-line bg-surface p-6 shadow-pop sm:max-w-[440px]" showCloseButton={false}>
          <DialogTitle className="text-sub font-semibold">Reset demo data?</DialogTitle>
          <DialogDescription className="text-ink-2">
            Projects you made in {workspaceName} are deleted, and the 4 demo projects come back as they started. This can&apos;t
            be undone.
          </DialogDescription>
          <DialogFooter className="mt-2 gap-2">
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Keep my data
            </Button>
            <Button variant="primary" onClick={reset} disabledReason={pending ? "Resetting…" : undefined}>
              {pending ? "Resetting…" : "Reset demo data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
