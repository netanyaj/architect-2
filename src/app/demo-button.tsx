"use client";

import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ax/button";
import { DemoSetupOverlay } from "@/components/ax/demo-setup";
import { startDemo } from "@/server/actions/auth";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <>
      <button type="submit" aria-disabled={pending || undefined} className={buttonClasses({ variant: "primary" })}>
        {pending ? "Setting up…" : "Try the demo"}
      </button>
      {pending && <DemoSetupOverlay />}
    </>
  );
}

/** Try the demo (M6 landing page): the same startDemo() as the sign-in page's link. */
export function DemoButton() {
  return (
    <form action={startDemo}>
      <Submit />
    </form>
  );
}
