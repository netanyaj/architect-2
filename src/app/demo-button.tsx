"use client";

import { useFormStatus } from "react-dom";
import { buttonClasses } from "@/components/ax/button";
import { startDemo } from "@/server/actions/auth";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" aria-disabled={pending || undefined} className={buttonClasses({ variant: "primary" })}>
      {pending ? "Opening the demo…" : "Try the demo"}
    </button>
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
