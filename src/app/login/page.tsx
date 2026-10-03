import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth-paths";
import { createServerDb } from "@/server/db";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · Architect" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : undefined);
  const error = typeof params.error === "string" ? params.error : undefined;

  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (user) redirect(next);

  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-[420px] flex-col gap-6 rounded-pane border border-line bg-surface p-8 shadow-pane max-sm:p-6">
        <div className="flex items-center gap-2.5 text-sub font-bold">
          <span className="grid size-[30px] place-items-center rounded-[9px] bg-primary text-body font-bold text-on-primary" aria-hidden="true">
            A
          </span>
          Architect
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-title font-[650]">Sign in</h1>
          <p className="text-ink-2">Describe an app once. You see the plan and what it costs before anything is built.</p>
        </div>
        <LoginForm next={next} error={error} />
      </div>
    </main>
  );
}
