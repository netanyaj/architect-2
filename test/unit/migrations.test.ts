/**
 * Runs the real migrations on PGlite (Postgres in WASM) with a minimal stand-in for Supabase's
 * auth schema, roles and Realtime publication, then checks the demo seed, first sign-in and reset.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS = join(__dirname, "../../supabase/migrations");

const SUPABASE_STUB = `
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create publication supabase_realtime;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint);
`;

const MORGAN = "00000000-0000-0000-0000-00000000000a";
const REVIEWER = "00000000-0000-0000-0000-00000000000b";
const LEGACY = "00000000-0000-0000-0000-00000000000c";

let db: PGlite;

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number((await one<{ n: number | string }>(sql, params)).n);
}

beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await db.query("insert into auth.users (id, email) values ($1, 'morgan@example.com'), ($2, 'reviewer@example.com'), ($3, 'jane.doe@example.com')", [MORGAN, REVIEWER, LEGACY]);
  // Apply migrations in order; just before 0003, make a workspace the 0002 way (as the live database had).
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (f.startsWith("0003")) await db.query("select create_demo_workspace($1, 'jane.doe@example.com', 'Jane')", [LEGACY]);
    await db.exec(readFileSync(join(MIGRATIONS, f), "utf8"));
  }
}, 60_000);

describe("create_demo_workspace", () => {
  it("gives a new person their own seeded Acme Ops, as Owner", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const w = await one<{ name: string; governance_enabled: boolean }>("select name, governance_enabled from workspaces where id = $1", [ws]);
    expect(w).toEqual({ name: "Morgan's Acme Ops", governance_enabled: true });
    expect(await one("select role, status from members where workspace_id = $1 and user_id = $2", [ws, MORGAN])).toEqual({ role: "owner", status: "active" });

    const projects = await db.query<{ name: string; status: string; total: number; built: number }>(
      `select p.name, p.status, count(i.*)::int as total, count(i.*) filter (where i.status = 'built')::int as built
       from projects p join items i on i.project_id = p.id where p.workspace_id = $1 group by p.name, p.status order by p.name`,
      [ws],
    );
    expect(projects.rows).toEqual([
      { name: "Lead scorer", status: "paused", total: 7, built: 4 },
      { name: "Meeting Prep", status: "live", total: 12, built: 12 },
      { name: "Vendor tracker", status: "draft", total: 3, built: 0 },
      { name: "ticket-triage", status: "built", total: 6, built: 5 },
    ]);
    expect(await count("select sum(credits) as n from usage_ledger where workspace_id = $1", [ws])).toBe(372);
    expect(await count("select count(*) as n from approvals where workspace_id = $1 and status = 'waiting'", [ws])).toBe(3);
    expect(await count("select count(*) as n from members where workspace_id = $1 and status = 'invited'", [ws])).toBe(2);
  });

  it("shows Sam as ticket-triage's owner while the real owner is the signed-in person", async () => {
    const p = await one<{ owner_id: string; owner_display_name: string }>(
      "select owner_id, owner_display_name from projects where name = 'ticket-triage' and owner_id = $1",
      [MORGAN],
    );
    expect(p).toEqual({ owner_id: MORGAN, owner_display_name: "Sam" });
    expect(
      await count("select count(*) as n from approvals a join members m on m.workspace_id = a.workspace_id where m.user_id = $1 and a.kind in ('deploy','token') and a.payload->>'requested_by_name' = 'Sam'", [MORGAN]),
    ).toBe(2);
    expect(await count("select count(*) as n from projects where name <> 'ticket-triage' and owner_display_name is not null")).toBe(0);
  });

  it("every built part has a passing proof (DATA-MODEL rule 5)", async () => {
    expect(
      await count(`select count(*) as n from items i where i.status = 'built'
                   and not exists (select 1 from proofs p where p.item_id = i.id and p.result = 'pass')`),
    ).toBe(0);
  });

  it("is idempotent: signing in again returns the same workspace", async () => {
    const a = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const b = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    expect(a.ws).toBe(b.ws);
    expect(await count("select count(*) as n from members where user_id = $1", [MORGAN])).toBe(1);
  });

  it("keeps reviewers apart: a second person gets a separate workspace", async () => {
    const m = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const r = await one<{ ws: string }>("select create_demo_workspace($1, 'reviewer@example.com', 'Reviewer') as ws", [REVIEWER]);
    expect(r.ws).not.toBe(m.ws);
    expect(await count("select count(*) as n from workspaces")).toBe(3); // Morgan's, the reviewer's, and Jane's from before 0003
  });
});

describe("distinct workspace names (0003)", () => {
  it("names each workspace after its owner, so two people's are never the same", async () => {
    const m = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const r = await one<{ ws: string }>("select create_demo_workspace($1, 'reviewer@example.com', '') as ws", [REVIEWER]);
    const name = async (ws: string) => (await one<{ name: string }>("select name from workspaces where id = $1", [ws])).name;
    expect(await name(m.ws)).toBe("Morgan's Acme Ops");
    expect(await name(r.ws)).toBe("Reviewer's Acme Ops"); // no name: from the email
  });

  it("renamed the workspace that existed before, and its seeded log line", async () => {
    const { ws } = await one<{ ws: string }>("select workspace_id as ws from members where user_id = $1 and role = 'owner'", [LEGACY]);
    expect((await one<{ name: string }>("select name from workspaces where id = $1", [ws])).name).toBe("Jane's Acme Ops");
    expect(await count("select count(*) as n from audit_log where workspace_id = $1 and action = 'workspace.seeded' and target = 'Jane''s Acme Ops'", [ws])).toBe(1);
  });

  it("the name rule handles empty and odd input", async () => {
    const rule = async (n: string | null, e: string | null) => (await one<{ v: string }>("select workspace_name_for($1, $2) as v", [n, e])).v;
    expect(await rule("  netanya jaison ", null)).toBe("Netanya's Acme Ops");
    expect(await rule(null, "sam.rivera@example.com")).toBe("Sam's Acme Ops");
    expect(await rule("", "")).toBe("Acme Ops");
  });
});

describe("reset_demo_workspace", () => {
  it("restores the demo data and keeps people, tickets and the audit log", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const meetingPrep = await one<{ id: string }>("select id from projects where workspace_id = $1 and name = 'Meeting Prep'", [ws]);
    // Change things a reviewer might change.
    await db.query("insert into projects (workspace_id, name, owner_id) values ($1, 'My test app', $2)", [ws, MORGAN]);
    await db.query("delete from projects where workspace_id = $1 and name = 'Vendor tracker'", [ws]);
    await db.query("update connections set status = 'connected' where workspace_id = $1", [ws]);
    await db.query("insert into members (workspace_id, invited_email, email, role, status) values ($1, 'friend@example.com', 'friend@example.com', 'viewer', 'invited')", [ws]);
    await db.query("insert into support_tickets (user_id, project_id, workspace_id, question) values ($1, $2, $3, 'Why?')", [MORGAN, meetingPrep.id, ws]);

    await db.query("select reset_demo_workspace($1, $2)", [ws, MORGAN]);

    const names = (await db.query<{ name: string }>("select name from projects where workspace_id = $1 order by name", [ws])).rows.map((r) => r.name);
    expect(names).toEqual(["Lead scorer", "Meeting Prep", "Vendor tracker", "ticket-triage"]);
    expect(await count("select count(*) as n from connections where workspace_id = $1 and status = 'missing'", [ws])).toBe(2);
    expect(await count("select sum(credits) as n from usage_ledger where workspace_id = $1", [ws])).toBe(372);
    expect(await count("select count(*) as n from members where workspace_id = $1 and status = 'invited'", [ws])).toBe(3); // Sam, Jordan, friend
    expect(await count("select count(*) as n from members where workspace_id = $1 and user_id = $2 and role = 'owner'", [ws, MORGAN])).toBe(1);
    expect(await count("select count(*) as n from support_tickets where question = 'Why?' and project_id is null")).toBe(1);
    expect(await count("select count(*) as n from audit_log where workspace_id = $1 and action = 'workspace.reset'", [ws])).toBe(1);
  });

  it("refuses anyone who isn't the workspace owner", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    await expect(db.query("select reset_demo_workspace($1, $2)", [ws, REVIEWER])).rejects.toThrow(/Only the workspace owner/);
  });
});

describe("function privileges", () => {
  it("API roles can't call the seed, create or reset functions", async () => {
    for (const fn of ["seed_demo_workspace(uuid,uuid)", "create_demo_workspace(uuid,text,text)", "reset_demo_workspace(uuid,uuid)"]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await one<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`);
        expect(r.ok, `${role} → ${fn}`).toBe(false);
      }
    }
  });
});

describe("agree_and_build (the Build gate, DATA-MODEL rule 1)", () => {
  const VIEWER = "00000000-0000-0000-0000-00000000000d";

  async function draftPlan(opts: { blocking?: boolean; answered?: boolean; total?: number; budget?: number | null } = {}) {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const { id: project } = await one<{ id: string }>(
      "insert into projects (workspace_id, name, owner_id, budget_credits) values ($1, 'Gate test', $2, $3) returning id",
      [ws, MORGAN, opts.budget ?? null],
    );
    const { id: bp } = await one<{ id: string }>(
      "insert into blueprints (project_id, version, prompt, total_likely) values ($1, 1, 'x', $2) returning id",
      [project, opts.total ?? 40],
    );
    await db.query(
      "insert into items (blueprint_id, project_id, key, grp, title, proved_when) values ($1, $2, 'a-part', 'features', 'A', 'p'), ($1, $2, 'b-part', 'features', 'B', 'p')",
      [bp, project],
    );
    if (opts.blocking) {
      await db.query(
        "insert into questions (blueprint_id, text, options, recommended, blocking, answer) values ($1, 'Which Slack workspace?', '[]', 'connected', true, $2)",
        [bp, opts.answered ? "connected" : null],
      );
    }
    return { ws, project, bp };
  }

  it("refuses while a blocking question is open, and nothing changes", async () => {
    const { bp, project } = await draftPlan({ blocking: true });
    await expect(db.query("select agree_and_build($1, $2)", [bp, MORGAN])).rejects.toThrow(/blocking_questions_open/);
    expect((await one<{ agreed_at: string | null }>("select agreed_at from blueprints where id = $1", [bp])).agreed_at).toBeNull();
    expect(await count("select count(*) as n from runs where project_id = $1", [project])).toBe(0);
  });

  it("agrees the plan, its parts and queues a run started by the person who clicked, in one go", async () => {
    const { bp, project } = await draftPlan({ blocking: true, answered: true });
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2) as run", [bp, MORGAN]);
    const plan = await one<{ status: string; agreed_at: string | null }>("select status, agreed_at from blueprints where id = $1", [bp]);
    expect(plan.status).toBe("agreed");
    expect(plan.agreed_at).not.toBeNull();
    expect(await count("select count(*) as n from items where blueprint_id = $1 and status = 'agreed'", [bp])).toBe(2);
    expect(await one("select kind, status, started_by from runs where id = $1", [run])).toEqual({ kind: "build", status: "queued", started_by: MORGAN });
    expect(await one("select status, current_version from projects where id = $1", [project])).toEqual({ status: "building", current_version: 1 });
  });

  it("supersedes older versions, and a plan can't be agreed twice", async () => {
    const { bp, project } = await draftPlan();
    const { id: v2 } = await one<{ id: string }>("insert into blueprints (project_id, version, prompt) values ($1, 2, 'x') returning id", [project]);
    await db.query("select agree_and_build($1, $2)", [v2, MORGAN]);
    expect((await one<{ status: string }>("select status from blueprints where id = $1", [bp])).status).toBe("superseded");
    await expect(db.query("select agree_and_build($1, $2)", [v2, MORGAN])).rejects.toThrow(/already_agreed/);
  });

  it("refuses a Viewer, and an estimate over the project budget", async () => {
    const { ws, bp } = await draftPlan({ total: 120, budget: 100 });
    await db.query("insert into auth.users (id, email) values ($1, 'viewer@example.com') on conflict do nothing", [VIEWER]);
    await db.query("insert into members (workspace_id, user_id, role, status, invite_token) values ($1, $2, 'viewer', 'active', null)", [ws, VIEWER]);
    await expect(db.query("select agree_and_build($1, $2)", [bp, VIEWER])).rejects.toThrow(/cannot_build/);
    await expect(db.query("select agree_and_build($1, $2)", [bp, MORGAN])).rejects.toThrow(/over_budget/);
  });

  it("new workspaces allow OpenRouter's free models; existing ones were updated", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const { config } = await one<{ config: { allowed: string[] } }>("select config from policies where workspace_id = $1 and kind = 'models'", [ws]);
    expect(config.allowed).toContain("openrouter");
    expect(await count("select count(*) as n from policies where kind = 'models' and not (config->'allowed') ? 'openrouter'")).toBe(0);
    // Reset demo data keeps it too.
    await db.query("select reset_demo_workspace($1, $2)", [ws, MORGAN]);
    expect((await one<{ config: { allowed: string[] } }>("select config from policies where workspace_id = $1 and kind = 'models'", [ws])).config.allowed).toContain("openrouter");
  });

  it("only one plan can be written at a time per project", async () => {
    const { project } = await draftPlan();
    await db.query("insert into blueprints (project_id, version, prompt, generation) values ($1, 7, 'x', 'writing')", [project]);
    await expect(db.query("insert into blueprints (project_id, version, prompt, generation) values ($1, 8, 'x', 'writing')", [project])).rejects.toThrow(/blueprints_one_writing/);
  });

  it("API roles can't call the Build gate or the seed helpers directly", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const fn of ["agree_and_build(uuid,uuid)", "apply_seed_updates(uuid)"]) {
        expect((await one<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok, `${role} → ${fn}`).toBe(false);
      }
    }
  });
});

describe("questions.default_effect (0005)", () => {
  it("stores the label, and only the four known values", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const { id: project } = await one<{ id: string }>("insert into projects (workspace_id, name) values ($1, 'Effects') returning id", [ws]);
    const { id: bp } = await one<{ id: string }>("insert into blueprints (project_id, version, prompt) values ($1, 1, 'x') returning id", [project]);
    await db.query("insert into questions (blueprint_id, text, options, recommended, blocking, default_effect) values ($1, 'Which SMS service?', '[]', 'twilio', true, 'none')", [bp]);
    expect((await one<{ default_effect: string }>("select default_effect from questions where blueprint_id = $1", [bp])).default_effect).toBe("none");
    await expect(db.query("insert into questions (blueprint_id, text, options, recommended, default_effect) values ($1, 'q', '[]', 'r', 'maybe')", [bp])).rejects.toThrow(/check/);
  });
});
