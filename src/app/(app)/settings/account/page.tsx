import type { Metadata } from "next";
import { buttonClasses } from "@/components/ax/button";
import { signOut } from "@/server/actions/auth";
import { getAppContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Account · Settings · Architect" };

/** Settings › Account: who you're signed in as, and Sign out. */
export default async function AccountSettingsPage() {
  const ctx = await getAppContext();
  return (
    <section aria-labelledby="account" className="flex flex-col gap-3">
      <h2 id="account" className="text-heading font-[650]">
        Your account
      </h2>
      <div className="flex flex-wrap items-center gap-4 rounded-card border border-line p-4">
        <dl className="grid flex-1 grid-cols-[100px_minmax(0,1fr)] gap-y-1.5">
          <dt className="text-ink-2">Name</dt>
          <dd>{ctx.name}</dd>
          <dt className="text-ink-2">Email</dt>
          <dd className="truncate">{ctx.user.email}</dd>
        </dl>
        <form action={signOut}>
          <button type="submit" className={buttonClasses({})}>
            Sign out
          </button>
        </form>
      </div>
    </section>
  );
}
