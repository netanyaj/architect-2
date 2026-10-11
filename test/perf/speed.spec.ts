import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "../e2e/build.spec.seed";
import { adminDb, createTestUser, deleteTestUser } from "../e2e/helpers";

/*
 * Speed (M5.5). For Home, a project and Launch: page load (a fresh navigation until the page's main content is on
 * screen, and the server's time to first byte), then click-to-paint (from the click until the next screen's content
 * shows). Each is the median of 5 runs, signed in as a new test user. Results go to PERF_OUT (JSON) and the console.
 */
const RUNS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function load(page: Page, url: string, ready: () => Promise<void>) {
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "commit" });
  await ready();
  const paint = Date.now() - t0;
  const ttfb = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return n ? Math.round(n.responseStart - n.requestStart) : -1;
  });
  return { paint, ttfb };
}

async function click(page: Page, act: () => Promise<void>, ready: () => Promise<void>) {
  const t0 = Date.now();
  await act();
  await ready();
  return Date.now() - t0;
}

test("speed: Home, a project and Launch", async ({ page }) => {
  const user = await createTestUser("speed");
  try {
    await signIn(page, user);
    const { data: m } = await adminDb().from("members").select("workspace_id, workspaces!inner(kind)").eq("user_id", user.id).eq("role", "owner").eq("workspaces.kind", "demo").single();
    const { data: p } = await adminDb().from("projects").select("id").eq("workspace_id", m!.workspace_id).eq("name", "Meeting Prep").single();
    const id = p!.id;
    const home = () => expect(page.getByRole("heading", { name: "What should we build?" })).toBeVisible({ timeout: 60_000 });
    const project = () => expect(page.getByRole("navigation", { name: "Project stage" })).toBeVisible({ timeout: 60_000 });
    const launch = () => expect(page.getByRole("heading", { name: /^Launch Meeting Prep/ })).toBeVisible({ timeout: 60_000 });

    // Warm once: the first request after a deploy starts the functions.
    await load(page, "/home", home);
    await load(page, `/p/${id}`, project);
    await load(page, `/p/${id}/launch`, launch);

    const r: Record<string, number[]> = { home: [], homeTtfb: [], project: [], projectTtfb: [], launch: [], launchTtfb: [], clickHomeToProject: [], clickProjectToLaunch: [], clickLaunchToProjects: [] };
    for (let i = 0; i < RUNS; i++) {
      const h = await load(page, "/home", home);
      r.home.push(h.paint);
      r.homeTtfb.push(h.ttfb);
      r.clickHomeToProject.push(await click(page, () => page.getByRole("link", { name: /Meeting Prep/ }).first().click(), project));
      const pr = await load(page, `/p/${id}`, project);
      r.project.push(pr.paint);
      r.projectTtfb.push(pr.ttfb);
      r.clickProjectToLaunch.push(await click(page, () => page.getByRole("navigation", { name: "Project stage" }).getByRole("button", { name: /Launch/ }).click(), launch));
      const l = await load(page, `/p/${id}/launch`, launch);
      r.launch.push(l.paint);
      r.launchTtfb.push(l.ttfb);
      r.clickLaunchToProjects.push(await click(page, () => page.getByRole("link", { name: "Back to projects" }).click(), () => expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible({ timeout: 60_000 })));
    }
    const out = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { median: median(v), runs: v }]));
    console.log(JSON.stringify(out, null, 2));
    if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(out, null, 2));
  } finally {
    await deleteTestUser(user);
  }
});
