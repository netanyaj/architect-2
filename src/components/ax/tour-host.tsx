import "server-only";

import type { ReactNode } from "react";
import { createAdminDb } from "@/server/db";
import { tourAvailable, tourFor } from "@/server/tour";
import { getAppContext } from "@/server/workspace";
import { TourGuide, TourProvider } from "./tour-guide";

/**
 * The tour for a page (M6, Tour v2): read on the server, kept fresh in the browser. `corner` pages have no side nav or
 * Parts pane to hold the guide, so it sits in the bottom-left corner; elsewhere it's in their flow, and in the phone's
 * bottom bar beside Help.
 */
export async function TourHost({ corner = false, children }: { corner?: boolean; children: ReactNode }) {
  const ctx = await getAppContext();
  const tour = await tourFor(createAdminDb(), ctx);
  return (
    <TourProvider initial={tour} available={tourAvailable(ctx)}>
      {children}
      <TourGuide placement={corner ? "corner" : "bar"} />
    </TourProvider>
  );
}
