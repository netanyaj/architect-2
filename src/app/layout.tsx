import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Figtree, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Architect",
  description: "Describe an app. Architect writes the plan, you build it with one click.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The person's theme setting (Settings › Appearance). Light unless they chose dark.
  const theme = (await cookies()).get("ax_theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang="en" data-theme={theme} className={`${figtree.variable} ${geistMono.variable} h-full`}>
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
