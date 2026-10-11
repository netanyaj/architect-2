import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Figtree, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { userTheme } from "@/server/theme";
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
  // The person's theme setting, everywhere including Developer view: Light, Dark, or System (the device's, set before
  // the first paint by the script below and kept in step if the device changes).
  const theme = await userTheme();
  return (
    <html lang="en" data-theme={theme === "system" ? "light" : theme} data-theme-choice={theme} className={`${figtree.variable} ${geistMono.variable} h-full`} suppressHydrationWarning>
      <head>
        {theme === "system" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){var m=window.matchMedia("(prefers-color-scheme: dark)");function s(){if(document.documentElement.dataset.themeChoice==="system")document.documentElement.dataset.theme=m.matches?"dark":"light"}s();m.addEventListener("change",s)})();`,
            }}
          />
        )}
      </head>
      <body className="min-h-full">
        <TooltipProvider>{children}</TooltipProvider>
        {/* Page views only, no cookies (M5.10). Product events go to our own analytics_events table. */}
        <Analytics />
      </body>
    </html>
  );
}
