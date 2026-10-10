import type { Metadata } from "next";
import { canBuild } from "@/lib/permissions";
import { getAppContext } from "@/server/workspace";
import { DecideFlow } from "./decide-flow";

export const metadata: Metadata = { title: "Help me decide · Architect" };

/** Help me decide (screen 14): three questions, then three ideas worth building. */
export default async function DecidePage() {
  const ctx = await getAppContext();
  return <DecideFlow canStart={canBuild(ctx.role)} />;
}
