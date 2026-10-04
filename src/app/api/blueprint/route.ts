import { z } from "zod";
import { MODEL_CHOICES } from "@/lib/models";
import { writePlan, PlanRefused, type PlanEvent } from "@/server/blueprint/write-plan";
import { createAdminDb, createServerDb } from "@/server/db";
import { getAppContext } from "@/server/workspace";

// A plan takes a few seconds on flash-lite; allow for slower models and the one retry.
export const maxDuration = 120;

const body = z.object({
  projectId: z.string().uuid(),
  model: z.enum(MODEL_CHOICES).optional(),
  /** A changed request ("Edit my request"); otherwise the project's own prompt. */
  prompt: z.string().max(4000).optional(),
});

/**
 * POST /api/blueprint: writes the plan and streams it as newline-delimited JSON events (PlanEvent).
 * Each part is also saved as it arrives, so a reload (or another tab, via Realtime) shows the same thing.
 * It never starts a build: that waits for the person's click on Build.
 */
export async function POST(request: Request) {
  const db = await createServerDb();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ message: "Sign in to write a plan." }, { status: 401 });

  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ message: "That request isn't valid." }, { status: 400 });

  const ctx = await getAppContext();
  const admin = createAdminDb();
  const encoder = new TextEncoder();

  // Refusals are plain JSON errors; once the plan exists, everything (including failures) is a stream event.
  let started: (value: Response) => void;
  const response = new Promise<Response>((resolve) => (started = resolve));
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  let open = true;
  const emit = (e: PlanEvent) => {
    if (e.type === "started") started(new Response(stream.readable, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } }));
    if (!open) return;
    // If the person leaves, keep writing the plan; it's saved as it goes and appears when they return.
    writer.write(encoder.encode(`${JSON.stringify(e)}\n`)).catch(() => (open = false));
  };

  writePlan({ admin, ctx, projectId: parsed.data.projectId, prompt: parsed.data.prompt, model: parsed.data.model }, emit)
    .catch((err) => {
      if (err instanceof PlanRefused) started(Response.json({ message: err.message }, { status: err.status }));
      else started(Response.json({ message: "The plan couldn't be started. Try again." }, { status: 500 }));
    })
    .finally(() => {
      open = false;
      writer.close().catch(() => {});
    });

  return response;
}
