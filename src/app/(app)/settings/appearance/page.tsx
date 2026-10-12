import type { Metadata } from "next";
import { canBuild } from "@/lib/permissions";
import { userOpenInDev, userTheme } from "@/server/theme";
import { getAppContext } from "@/server/workspace";
import { AppearanceSection } from "../appearance-section";

export const metadata: Metadata = { title: "Appearance · Settings · Architect" };

/** Settings › Appearance: the theme, and whether projects open in Developer view. Saved to the person's account. */
export default async function AppearanceSettingsPage() {
  const ctx = await getAppContext();
  return <AppearanceSection theme={await userTheme()} openInDev={await userOpenInDev()} canBuild={canBuild(ctx.role)} />;
}
