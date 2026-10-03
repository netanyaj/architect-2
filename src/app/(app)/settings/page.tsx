import type { Metadata } from "next";
import { buttonClasses } from "@/components/ax/button";
import { signOut } from "@/server/actions/auth";
import { getAppContext } from "@/server/workspace";

export const metadata: Metadata = { title: "Settings · Architect" };

/** Account basics. Members, invites, budgets, theme and Reset demo data arrive in task 6. */
export default async function SettingsPage() {
  const ctx = await getAppContext();
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6 px-8 pt-10 pb-10 max-sm:px-4">
      <h1 className="text-title font-[650]">Settings</h1>
      <section className="flex flex-col gap-3 rounded-card border border-line p-4">
        <h2 className="text-sub font-semibold">Your account</h2>
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-2">
          <dt className="text-ink-2">Name</dt>
          <dd>{ctx.name}</dd>
          <dt className="text-ink-2">Email</dt>
          <dd>{ctx.user.email}</dd>
          <dt className="text-ink-2">Workspace</dt>
          <dd>
            {ctx.workspace.name} · <span className="capitalize">{ctx.role}</span>
          </dd>
        </dl>
        <form action={signOut}>
          <button type="submit" className={buttonClasses({})}>
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}
