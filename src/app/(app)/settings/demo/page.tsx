import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canResetDemo } from "@/lib/permissions";
import { getAppContext } from "@/server/workspace";
import { DemoDataSection } from "../demo-data-section";

export const metadata: Metadata = { title: "Demo data · Settings · Architect" };

/** Settings › Demo data: the Owner of a demo workspace puts it back the way it started. */
export default async function DemoSettingsPage() {
  const ctx = await getAppContext();
  if (!canResetDemo(ctx.role) || ctx.workspace.kind === "personal") notFound();
  return <DemoDataSection workspaceName={ctx.workspace.name} />;
}
