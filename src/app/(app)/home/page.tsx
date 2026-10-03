import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ax/button";
import { createServerDb } from "@/server/db";
import { displayNameFor } from "@/server/workspace";
import { HomeComposer } from "./home-composer";

export const metadata: Metadata = { title: "Home · Architect" };

export default async function HomePage() {
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  const signedIn = Boolean(user);

  const content = (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-9 px-8 pt-14 pb-10 max-sm:px-4 max-sm:pt-8">
      <HomeComposer signedIn={signedIn} firstName={user ? displayNameFor(user).split(" ")[0] : undefined} />
    </div>
  );

  if (signedIn) return content;

  // Signed out: the composer works, and Write the plan keeps the prompt through sign-in.
  return (
    <div className="flex min-h-dvh flex-col bg-canvas p-2.5">
      <div className="flex flex-1 flex-col rounded-pane border border-line bg-surface shadow-pane">
        <header className="flex items-center gap-2.5 px-6 pt-5 text-sub font-bold">
          <span className="grid size-[30px] place-items-center rounded-[9px] bg-primary text-body font-bold text-on-primary" aria-hidden="true">
            A
          </span>
          Architect
          <span className="flex-1" />
          <Link href="/login" className={buttonClasses({})}>
            Sign in
          </Link>
        </header>
        {content}
      </div>
    </div>
  );
}
