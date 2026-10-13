import "server-only";

import type { ReactNode } from "react";
import { createAdminDb } from "@/server/db";
import { tourAvailable, tourFor } from "@/server/tour";
import { getAppContext } from "@/server/workspace";
import { TourProvider } from "./tour-guide";

/** The tour for a page (round 7): read on the server, then kept in the browser across pages. */
export async function TourHost({ children }: { children: ReactNode }) {
  const ctx = await getAppContext();
  const tour = await tourFor(createAdminDb(), ctx);
  return (
    <TourProvider initial={tour} available={tourAvailable(ctx)}>
      {children}
    </TourProvider>
  );
}
