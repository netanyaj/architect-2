import { createAdminDb } from "@/server/db";
import { purgeDeleted } from "@/server/trash";

/**
 * The daily purge (Vercel Cron, vercel.json): projects deleted more than 30 days ago go for good, with their files.
 * Vercel calls it with `Authorization: Bearer $CRON_SECRET`; without that secret set, it does nothing (Recently
 * deleted also purges whenever it's opened).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ message: "CRON_SECRET isn't set, so the daily purge is off." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ message: "Not allowed." }, { status: 401 });
  const purged = await purgeDeleted(createAdminDb(), null);
  return Response.json({ purged });
}
