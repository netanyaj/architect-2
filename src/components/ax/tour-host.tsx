import "server-only";

import type { ReactNode } from "react";
import { createAdminDb } from "@/server/db";
import { tourAvailable, tourFor } from "@/server/tour";
import { getAppContext } from "@/server/workspace";
import { CoachCard, TourProvider } from "./tour-guide";

/**
 * The tour for a page (M6, Tour v3): read on the server, kept fresh in the browser. The coach card sits bottom left:
 * past the side nav on app pages (`nav`), at the page's edge on project and settings pages; a bottom sheet on a phone.
 */
export async function TourHost({ inset = "edge", children }: { inset?: "nav" | "edge"; children: ReactNode }) {
  const ctx = await getAppContext();
  const tour = await tourFor(createAdminDb(), ctx);
  return (
    <TourProvider initial={tour} available={tourAvailable(ctx)}>
      {children}
      <CoachCard inset={inset} initial={tour} />
    </TourProvider>
  );
}
