import { createAdminDb } from "@/server/db";
import { deleteExpiredDemoUsers } from "@/server/demo";
import { purgeDeleted } from "@/server/trash";

/**
 * The daily purge (Vercel Cron, vercel.json): projects deleted more than 30 days ago go for good, with their files,
 * and demo visitors (anonymous sign-ins) older than 7 days go with their workspaces (M5.10).
 * Vercel calls it with `Authorization: Bearer $CRON_SECRET`; without that secret set, it does nothing (Recently
 * deleted also purges whenever it's opened).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ message: "CRON_SECRET isn't set, so the daily purge is off." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ message: "Not allowed." }, { status: 401 });
  const admin = createAdminDb();
  const purged = await purgeDeleted(admin, null);
  const demoUsers = await deleteExpiredDemoUsers(admin);
  return Response.json({ purged, demoUsers });
}
