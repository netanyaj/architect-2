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
  create schema vault;
  create table vault.secrets (id uuid primary key default gen_random_uuid(), secret text not null, name text, description text);
  create view vault.decrypted_secrets as select id, secret as decrypted_secret, name from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
    language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
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
    expect(w).toEqual({ name: "Acme Ops (Enterprise)", governance_enabled: true });
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
    // The demo and a Personal workspace (0021), never more.
    expect(await count("select count(*) as n from members where user_id = $1", [MORGAN])).toBe(2);
  });

  it("keeps reviewers apart: a second person gets a separate workspace", async () => {
    const m = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const r = await one<{ ws: string }>("select create_demo_workspace($1, 'reviewer@example.com', 'Reviewer') as ws", [REVIEWER]);
    expect(r.ws).not.toBe(m.ws);
    expect(await count("select count(*) as n from workspaces where kind = 'demo'")).toBe(3); // Morgan's, the reviewer's, and Jane's from before 0003
  });
});

describe("workspace names (0003, then 0021)", () => {
  it("every demo is Acme Ops (Enterprise); the app shows whose it is when it isn't yours", async () => {
    const m = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const r = await one<{ ws: string }>("select create_demo_workspace($1, 'reviewer@example.com', '') as ws", [REVIEWER]);
    const name = async (ws: string) => (await one<{ name: string }>("select name from workspaces where id = $1", [ws])).name;
    expect(await name(m.ws)).toBe("Acme Ops (Enterprise)");
    expect(await name(r.ws)).toBe("Acme Ops (Enterprise)");
  });

  it("the demo from before 0003 was renamed again by 0021, and its owner got a Personal workspace", async () => {
    const { ws } = await one<{ ws: string }>("select m.workspace_id as ws from members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 and m.role = 'owner' and w.kind = 'demo'", [LEGACY]);
    expect((await one<{ name: string }>("select name from workspaces where id = $1", [ws])).name).toBe("Acme Ops (Enterprise)");
    expect(await count("select count(*) as n from members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 and w.kind = 'personal'", [LEGACY])).toBe(1);
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
    expect(names).toEqual(["Lead scorer", "Meeting Prep", "Ticket triage (Architect 1.0)", "Vendor tracker", "ticket-triage"]);
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
      for (const fn of ["agree_and_build(uuid,uuid,text)", "settle_run(uuid)", "start_followup_run(uuid,uuid,text,jsonb,numeric)", "apply_seed_updates(uuid)"]) {
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

describe("Gemini default and the slow error kind (0006)", () => {
  it("new projects default to Gemini, and a plan can stop as slow", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const { id: project, model } = await one<{ id: string; model: string }>("insert into projects (workspace_id, name) values ($1, 'Defaults') returning id, model", [ws]);
    expect(model).toBe("gemini");
    await db.query("insert into blueprints (project_id, version, prompt, generation, error_kind) values ($1, 1, 'x', 'failed', 'slow')", [project]);
    await expect(db.query("insert into blueprints (project_id, version, prompt, generation, error_kind) values ($1, 2, 'x', 'failed', 'sleepy')", [project])).rejects.toThrow(/check/);
  });
});

describe("the simulator's runs (0007)", () => {
  async function plan(opts: { budget?: number | null } = {}) {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const { id: project } = await one<{ id: string }>("insert into projects (workspace_id, name, owner_id, budget_credits) values ($1, 'Sim test', $2, $3) returning id", [ws, MORGAN, opts.budget ?? null]);
    const { id: bp } = await one<{ id: string }>("insert into blueprints (project_id, version, prompt, total_likely) values ($1, 1, 'x', 30) returning id", [project]);
    const ids: Record<string, string> = {};
    for (const [key, title] of [["writer", "Brief writer"], ["mail", "Gmail read"], ["crm", "HubSpot sync"], ["later", "Later part"]]) {
      ids[key] = (await one<{ id: string }>("insert into items (blueprint_id, project_id, key, grp, title, proved_when, estimate_likely) values ($1, $2, $3, 'agents', $4, 'p', 10) returning id", [bp, project, key, title])).id;
    }
    return { ws, project, bp, ids };
  }

  /** What startRun writes: the running run with its outcome, and a check per part written before its code. */
  async function running(run: string, ids: Record<string, string>, outcome: unknown, endsAgoMs = 1000) {
    await db.query("update runs set status = 'running', started_at = now() - interval '2 minutes', ends_at = now() - ($2 || ' milliseconds')::interval, outcome = $3 where id = $1", [run, String(endsAgoMs), JSON.stringify(outcome)]);
    for (const id of Object.values(ids)) await db.query("insert into checks (item_id, kind, description) values ($1, 'eval', 'p')", [id]);
  }

  const OUTCOME = {
    status: "done",
    failure: { check: "brief is 200 words or fewer", measured: "236 words" },
    outcomes: [
      { key: "writer", status: "built", statusDetail: null, credits: 11, fixes: [{ attempt: 1, credits: 2, measured: null, note: null }], attempts: [{ attempt: 1, measured: null, note: null, credits: 2, result: "pass" }], proof: { kind: "eval", assertions: [3, 3], screenshot: false } },
      { key: "mail", status: "needs_connection", statusDetail: "using sample data until connected", credits: 9, fixes: [], attempts: [], proof: { kind: "api_test", assertions: [3, 3], screenshot: false }, provider: "gmail" },
      { key: "crm", status: "needs_approval", statusDetail: "IT admin reviews", credits: 0, fixes: [], attempts: [], proof: null, provider: "hubspot_crm" },
    ],
  };

  it("the gate records the run's kind, and refuses a second run while one is going", async () => {
    const { bp, project } = await plan();
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2, 'build') as run", [bp, MORGAN]);
    expect(await one("select kind, status, variant, speed from runs where id = $1", [run])).toEqual({ kind: "build", status: "queued", variant: "default", speed: "1" });
    const { id: v2 } = await one<{ id: string }>("insert into blueprints (project_id, version, prompt) values ($1, 2, 'x') returning id", [project]);
    await expect(db.query("select agree_and_build($1, $2, 'change')", [v2, MORGAN])).rejects.toThrow(/run_in_progress/);
    await expect(db.query("select agree_and_build($1, $2, 'deploy')", [v2, MORGAN])).rejects.toThrow(/bad_run_kind/);
  });

  it("a change is checked against the budget for the parts it builds, not the whole plan", async () => {
    const { bp, project } = await plan({ budget: 50 });
    await db.query("update items set status = 'built' where blueprint_id = $1 and key <> 'later'", [bp]);
    await db.query("insert into usage_ledger (workspace_id, project_id, kind, credits) select workspace_id, id, 'build', 35 from projects where id = $1", [project]);
    // The whole plan (30) would pass 50 with 35 spent; the one new part (10) doesn't.
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2, 'change') as run", [bp, MORGAN]);
    expect((await one<{ kind: string }>("select kind from runs where id = $1", [run])).kind).toBe("change");
  });

  it("settles once the time is up: statuses, proofs, Usage lines and an approval request, then never again", async () => {
    const { ws, bp, project, ids } = await plan();
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2) as run", [bp, MORGAN]);
    await running(run, ids, OUTCOME, -60_000); // ends in a minute
    expect((await one<{ s: string }>("select settle_run($1) as s", [run])).s).toBe("running");
    expect(await count("select count(*) as n from usage_ledger where run_id = $1", [run])).toBe(0);

    await db.query("update runs set ends_at = now() - interval '1 second' where id = $1", [run]);
    expect((await one<{ s: string }>("select settle_run($1) as s", [run])).s).toBe("done");
    expect((await one<{ s: string }>("select settle_run($1) as s", [run])).s).toBe("done"); // idempotent

    const items = await db.query<{ key: string; status: string; cost_actual: string; fix_attempts: number }>("select key, status, cost_actual, fix_attempts from items where blueprint_id = $1 order by key", [bp]);
    expect(items.rows).toEqual([
      { key: "crm", status: "needs_approval", cost_actual: "0", fix_attempts: 0 },
      { key: "later", status: "agreed", cost_actual: "0", fix_attempts: 0 },
      { key: "mail", status: "needs_connection", cost_actual: "9", fix_attempts: 0 },
      { key: "writer", status: "built", cost_actual: "13", fix_attempts: 1 },
    ]);
    const usage = await db.query<{ kind: string; credits: string; note: string }>("select kind, credits, note from usage_ledger where run_id = $1 order by kind", [run]);
    expect(usage.rows).toEqual([
      { kind: "build", credits: "20", note: "Build · 2 parts" },
      { kind: "fix", credits: "2", note: "Fix · Brief writer, try 1 of 3" },
    ]);
    const proofs = await db.query<{ attempt: number; result: string; summary: string }>("select attempt, result, summary from proofs where item_id = $1 order by attempt", [ids.writer]);
    expect(proofs.rows).toEqual([
      { attempt: 0, result: "fail", summary: "Failed: 236 words" },
      { attempt: 1, result: "pass", summary: "All assertions passed" },
    ]);
    expect(await one("select title, status, payload->>'provider' as provider from approvals where workspace_id = $1 and project_id = $2", [ws, project])).toEqual({ title: "Hubspot Crm connector", status: "waiting", provider: "hubspot_crm" });
    expect(await one("select status from projects where id = $1", [project])).toEqual({ status: "built" });
    expect(await one("select status from runs where id = $1", [run])).toEqual({ status: "done" });
  });

  it("follow-up runs need an agreed plan, a builder, no run going and room in the budget", async () => {
    const { bp, project } = await plan({ budget: 100 });
    await expect(db.query("select start_followup_run($1, $2, 'build', null, 5)", [project, MORGAN])).rejects.toThrow(/plan_not_agreed/);
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2) as run", [bp, MORGAN]);
    await expect(db.query("select start_followup_run($1, $2, 'fix', '[\"writer\"]', 3)", [project, MORGAN])).rejects.toThrow(/run_in_progress/);
    await db.query("update runs set status = 'paused_budget' where id = $1", [run]);
    await db.query("insert into usage_ledger (workspace_id, project_id, kind, credits) select workspace_id, id, 'build', 98 from projects where id = $1", [project]);
    await expect(db.query("select start_followup_run($1, $2, 'fix', '[\"writer\"]', 3)", [project, MORGAN])).rejects.toThrow(/over_budget/);
    const { r } = await one<{ r: string }>("select start_followup_run($1, $2, 'fix', '[\"writer\"]', 2) as r", [project, MORGAN]);
    expect(await one("select kind, status, outcome from runs where id = $1", [r])).toEqual({ kind: "fix", status: "queued", outcome: { focus: ["writer"] } });
    expect(await one("select status from projects where id = $1", [project])).toEqual({ status: "building" });
  });

  it("a retry adds to the part's fixes and names the extra try", async () => {
    const { bp, ids } = await plan();
    await db.query("update items set fix_attempts = 3, status = 'paused' where id = $1", [ids.writer]);
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2) as run", [bp, MORGAN]);
    await db.query("update runs set kind = 'fix' where id = $1", [run]);
    await running(run, ids, {
      status: "done",
      outcomes: [{ key: "writer", status: "built", statusDetail: null, credits: 0, fixes: [{ attempt: 4, credits: 3, note: "Tried once more" }], attempts: [{ attempt: 4, result: "pass", note: "Tried once more" }], proof: { kind: "eval", assertions: [3, 3] } }],
    });
    await db.query("select settle_run($1)", [run]);
    expect(await one("select status, fix_attempts from items where id = $1", [ids.writer])).toEqual({ status: "built", fix_attempts: 4 });
    expect(await one("select kind, note from usage_ledger where run_id = $1", [run])).toEqual({ kind: "fix", note: "Fix · Brief writer, one more try" });
    expect(await count("select count(*) as n from proofs where item_id = $1 and result = 'fail'", [ids.writer])).toBe(0);
  });

  it("a part whose service was connected while the build played settles as working", async () => {
    const { ws, bp, ids } = await plan();
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2) as run", [bp, MORGAN]);
    await running(run, ids, OUTCOME);
    await db.query("update connections set status = 'connected' where workspace_id = $1 and provider = 'gmail'", [ws]);
    await db.query("select settle_run($1)", [run]);
    expect(await one("select status, status_detail from items where id = $1", [ids.mail])).toEqual({ status: "built", status_detail: null });
  });

  it("a denied service files one request per project, naming the part and who asked (0016)", async () => {
    const { ws, bp, project, ids } = await plan();
    // Another project already waits for the same service: this one still files its own request.
    const { id: other } = await one<{ id: string }>("insert into projects (workspace_id, name) values ($1, 'Other') returning id", [ws]);
    await db.query("insert into approvals (workspace_id, project_id, kind, title, payload) values ($1, $2, 'connector', 'x', '{\"provider\": \"hubspot_crm\"}')", [ws, other]);
    await db.query("update items set description = 'Look up each lead in the CRM' where id = $1", [ids.crm]);
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2) as run", [bp, MORGAN]);
    await running(run, ids, OUTCOME);
    await db.query("select settle_run($1)", [run]);
    await db.query("select settle_run($1)", [run]);
    const rows = await db.query("select payload->>'item_title' as part, payload->>'why' as why, payload->>'requested_by_name' as by from approvals where project_id = $1", [project]);
    expect(rows.rows).toEqual([{ part: "HubSpot sync", why: "Look up each lead in the CRM", by: "Morgan Lee" }]);
  });

  it("a paused run leaves the project paused", async () => {
    const { bp, project, ids } = await plan();
    const { run } = await one<{ run: string }>("select agree_and_build($1, $2) as run", [bp, MORGAN]);
    await running(run, ids, { ...OUTCOME, status: "paused_budget" });
    expect((await one<{ s: string }>("select settle_run($1) as s", [run])).s).toBe("paused_budget");
    expect(await one("select status from projects where id = $1", [project])).toEqual({ status: "paused" });
  });
});

describe("launch options (0010)", () => {
  it("a deploy can fail, and a project has launch settings and an optional, unique test link", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const { id: project, launch_settings } = await one<{ id: string; launch_settings: unknown }>("insert into projects (workspace_id, name) values ($1, 'Launchy') returning id, launch_settings", [ws]);
    expect(launch_settings).toEqual({});
    await db.query("insert into deployments (project_id, environment, blueprint_version, status) values ($1, 'production', 1, 'failed')", [project]);
    await expect(db.query("insert into deployments (project_id, environment, blueprint_version, status) values ($1, 'production', 1, 'exploded')", [project])).rejects.toThrow(/check/);
    const token = "11111111-2222-4333-8444-555555555555";
    await db.query("update projects set test_share_token = $2 where id = $1", [project, token]);
    const { id: other } = await one<{ id: string }>("insert into projects (workspace_id, name) values ($1, 'Other') returning id", [ws]);
    await expect(db.query("update projects set test_share_token = $2 where id = $1", [other, token])).rejects.toThrow(/unique|duplicate/);
  });
});

describe("allow-rules (0016)", () => {
  it("members read their workspace's rules, and Reset demo data clears them with the policies", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'reviewer@example.com', 'Rita') as ws", [REVIEWER]);
    await db.query("insert into allow_rules (workspace_id, action, target, created_by_name) values ($1, 'connector', 'hubspot', 'Rita')", [ws]);
    await expect(db.query("insert into allow_rules (workspace_id, action, created_by_name) values ($1, 'anything', 'Rita')", [ws])).rejects.toThrow(/check/);
    // Plus the seeded Lead scorer and Clearbit rules (0019, 0020).
    expect(await count("select count(*) as n from allow_rules where workspace_id = $1", [ws])).toBe(3);
    await db.query("select reset_demo_workspace($1, $2)", [ws, REVIEWER]);
    expect(await count("select count(*) as n from allow_rules where workspace_id = $1 and created_by_name = 'Rita'", [ws])).toBe(0);
    expect(await one("select relrowsecurity from pg_class where relname = 'allow_rules'")).toEqual({ relrowsecurity: true });
  });
});

describe("keys, offline and secret requests (0017)", () => {
  it("a key is a name per version with who set it, never a value; Live can go offline; a secret request is an approval", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'reviewer@example.com', 'Rita') as ws", [REVIEWER]);
    const { id: project } = await one<{ id: string }>("select id from projects where workspace_id = $1 and name = 'Meeting Prep'", [ws]);
    await db.query("insert into project_keys (project_id, name, environment, set_by_name) values ($1, 'SLACK_BOT_TOKEN', 'production', 'Rita')", [project]);
    await expect(db.query("insert into project_keys (project_id, name, environment, set_by_name) values ($1, 'SLACK_BOT_TOKEN', 'production', 'Rita')", [project])).rejects.toThrow(/unique|duplicate/);
    await expect(db.query("insert into project_keys (project_id, name, environment, set_by_name) values ($1, 'bad name', 'staging', 'Rita')", [project])).rejects.toThrow(/check/);
    const cols = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'project_keys'");
    expect(cols.rows.map((c) => c.column_name)).not.toContain("value");
    expect(await one("select relrowsecurity from pg_class where relname = 'project_keys'")).toEqual({ relrowsecurity: true });
    await db.query("insert into deployments (project_id, environment, blueprint_version, status) values ($1, 'production', 1, 'offline')", [project]);
    await db.query("insert into approvals (workspace_id, project_id, kind, title) values ($1, $2, 'secret', 'Live key')", [ws, project]);
  });
});

describe("the Architect 1.0 app and part comments (0018)", () => {
  it("every new or reset workspace has one legacy app; anyone can read comments; a comment has a length", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'reviewer@example.com', 'Rita') as ws", [REVIEWER]);
    const legacy = await db.query<{ name: string; status: string; legacy_repo: string; owner_id: string }>("select name, status, legacy_repo, owner_id from projects where workspace_id = $1 and legacy_repo is not null", [ws]);
    expect(legacy.rows).toEqual([{ name: "Ticket triage (Architect 1.0)", status: "live", legacy_repo: "netanyaj/ticket-triage", owner_id: REVIEWER }]);
    await db.query("select reset_demo_workspace($1, $2)", [ws, REVIEWER]);
    expect(await count("select count(*) as n from projects where workspace_id = $1 and legacy_repo is not null", [ws])).toBe(1);
    const { id: project } = await one<{ id: string }>("select id from projects where workspace_id = $1 and name = 'Meeting Prep'", [ws]);
    await db.query("insert into part_comments (project_id, item_key, body, author_name) values ($1, 'brief-writer', 'Shorter please', 'Vic')", [project]);
    await expect(db.query("insert into part_comments (project_id, item_key, body, author_name) values ($1, 'brief-writer', '', 'Vic')", [project])).rejects.toThrow(/check/);
    expect(await one("select relrowsecurity from pg_class where relname = 'part_comments'")).toEqual({ relrowsecurity: true });
  });

  it("workspaces from before 0018 got the app too", async () => {
    const n = await count("select count(*) as n from workspaces w where w.kind = 'demo' and not exists (select 1 from projects p where p.workspace_id = w.id and p.legacy_repo is not null) and exists (select 1 from members m where m.workspace_id = w.id and m.role = 'owner' and m.user_id is not null)");
    expect(n).toBe(0);
  });
});

describe("API keys, plans, external-call rules and the Lead scorer seed (0019, 0020)", () => {
  it("a new or reset workspace's Lead scorer reads HubSpot under an allow-rule, with a Clearbit key set by Jordan", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'reviewer2@example.com', 'Rita') as ws", [REVIEWER]);
    const parts = await db.query<{ key: string; provider: string }>("select i.key, i.provider from items i join projects p on p.id = i.project_id where p.workspace_id = $1 and p.name = 'Lead scorer' and i.provider is not null order by i.position", [ws]);
    expect(parts.rows).toEqual([
      { key: "new-hubspot-leads-read", provider: "hubspot" },
      { key: "company-size-lookup", provider: "clearbit" },
      { key: "top-5-posted-to-sales", provider: "slack" },
    ]);
    const rules = await db.query("select action, target, project_id is null as everywhere, created_by_name from allow_rules where workspace_id = $1 order by target", [ws]);
    expect(rules.rows).toEqual([
      { action: "connector", target: "clearbit", everywhere: true, created_by_name: "Jordan (IT)" },
      { action: "connector", target: "hubspot", everywhere: false, created_by_name: "Jordan (IT)" },
    ]);
    // Clearbit's host is allowed for data (0020); HubSpot's isn't, so Lead scorer is held on api.hubapi.com.
    const { hosts } = await one<{ hosts: string[] }>("select config -> 'hosts' as hosts from policies where workspace_id = $1 and kind = 'egress'", [ws]);
    expect(hosts).toContain("api.clearbit.com");
    expect(hosts).not.toContain("api.hubapi.com");
    expect(await one("select kind, status, set_by_name from connections where workspace_id = $1 and provider = 'clearbit'", [ws])).toEqual({ kind: "api_key", status: "connected", set_by_name: "Jordan (IT)" });
    await db.query("select reset_demo_workspace($1, $2)", [ws, REVIEWER]);
    expect(await count("select count(*) as n from allow_rules where workspace_id = $1", [ws])).toBe(2);
    expect(await count("select count(*) as n from connections where workspace_id = $1 and provider = 'clearbit'", [ws])).toBe(1);
    expect(await count("select count(*) as n from policies, jsonb_array_elements_text(config -> 'hosts') h where workspace_id = $1 and kind = 'egress' and h = 'api.clearbit.com'", [ws])).toBe(1);
    // The seeded demo is on Enterprise; a workspace made any other way starts on Free.
    expect(await one("select plan from workspaces where id = $1", [ws])).toEqual({ plan: "enterprise" });
    expect(await one("insert into workspaces (name) values ('Blank') returning plan")).toEqual({ plan: "free" });
    await expect(db.query("update workspaces set plan = 'gold' where id = $1", [ws])).rejects.toThrow(/check/);
    await db.query("insert into allow_rules (workspace_id, action, target, created_by_name) values ($1, 'external_call', 'clearbit', 'Jordan (IT)')", [ws]);
    await db.query("insert into approvals (workspace_id, kind, title) values ($1, 'external_call', 'Clearbit calls with a key')", [ws]);
  });
});

describe("two workspaces per person, and how an imported agent runs (0021)", () => {
  it("first sign-in makes Acme Ops (Enterprise) and Personal; signing in again makes nothing new; Personal can't be reset", async () => {
    const U = "00000000-0000-4000-8000-0000000000aa";
    await db.query("insert into auth.users (id, email) values ($1, 'two@example.com') on conflict do nothing", [U]);
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'two@example.com', 'Tess') as ws", [U]);
    expect(await one("select name, kind, governance_enabled, plan from workspaces where id = $1", [ws])).toEqual({ name: "Acme Ops (Enterprise)", kind: "demo", governance_enabled: true, plan: "enterprise" });
    const owned = await db.query<{ name: string; kind: string; governance_enabled: boolean; plan: string }>("select w.name, w.kind, w.governance_enabled, w.plan from members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 order by w.kind", [U]);
    expect(owned.rows).toEqual([
      { name: "Acme Ops (Enterprise)", kind: "demo", governance_enabled: true, plan: "enterprise" },
      { name: "Personal", kind: "personal", governance_enabled: false, plan: "free" },
    ]);
    expect(await one<{ ws: string }>("select create_demo_workspace($1, 'two@example.com', 'Tess') as ws", [U])).toEqual({ ws });
    expect(await count("select count(*) as n from members where user_id = $1", [U])).toBe(2);
    const { id: personal } = await one<{ id: string }>("select w.id from members m join workspaces w on w.id = m.workspace_id where m.user_id = $1 and w.kind = 'personal'", [U]);
    expect(await count("select count(*) as n from projects where workspace_id = $1", [personal])).toBe(0);
    await expect(db.query("select reset_demo_workspace($1, $2)", [personal, U])).rejects.toThrow(/Personal workspaces/);
  });

  it("an agent runs natively, as a Studio agent, or as a tool", async () => {
    await expect(db.query("insert into agents (workspace_id, project_id, item_key, name, run_as) select workspace_id, id, 'x-run', 'X', 'elsewhere' from projects limit 1")).rejects.toThrow(/check/);
  });
});

describe("recently deleted projects (0022)", () => {
  it("a deleted project is hidden from members' reads, its parts with it; restoring brings both back", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    const { id } = await one<{ id: string }>("select id from projects where workspace_id = $1 and name = 'Vendor tracker'", [ws]);
    // Supabase grants read on public tables to signed-in users; RLS then decides which rows.
    await db.exec("grant usage on schema public, auth to authenticated; grant select on all tables in schema public to authenticated; grant execute on all functions in schema public, auth to authenticated;");
    // As on Supabase: new functions are executable by signed-in users unless a migration revoked it (as 0022 does for the purge).
    await db.exec("revoke execute on function purge_deleted_projects(uuid) from authenticated;");
    const asMorgan = async <T,>(sql: string, params: unknown[]) => {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${MORGAN}';`);
      try {
        return (await db.query<T>(sql, params)).rows;
      } finally {
        await db.exec("reset role;");
      }
    };
    expect(await asMorgan("select id from projects where id = $1", [id])).toHaveLength(1);
    await db.query("update projects set deleted_at = now(), deleted_by_name = 'Morgan' where id = $1", [id]);
    expect(await asMorgan("select id from projects where id = $1", [id])).toHaveLength(0);
    expect(await asMorgan("select id from items where project_id = $1", [id])).toHaveLength(0);
    await db.query("update projects set deleted_at = null where id = $1", [id]);
    expect((await asMorgan<{ id: string }>("select id from items where project_id = $1", [id])).length).toBeGreaterThan(0);
  });

  it("Recently deleted: listed for the person who deleted it and for Owners and Admins; restore checks who; permanent delete is Owner only; purge after 30 days", async () => {
    const SAM = "00000000-0000-0000-0000-0000000000dd";
    await db.query("insert into auth.users (id, email) values ($1, 'sam@x.com') on conflict do nothing", [SAM]);
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    await db.query("insert into members (workspace_id, user_id, email, display_name, role, status) values ($1, $2, 'sam@x.com', 'Sam', 'builder', 'active') on conflict do nothing", [ws, SAM]);
    const ids = await db.query<{ id: string; name: string }>("select id, name from projects where workspace_id = $1 and name in ('Lead scorer', 'Meeting Prep')", [ws]);
    const lead = ids.rows.find((r) => r.name === "Lead scorer")!.id;
    const prep = ids.rows.find((r) => r.name === "Meeting Prep")!.id;
    await db.query("update projects set deleted_at = now(), deleted_by = $2, deleted_by_name = 'Sam' where id = $1", [lead, SAM]);
    await db.query("update projects set deleted_at = now() - interval '31 days', deleted_by = $2 where id = $1", [prep, MORGAN]);
    const as = async <T,>(user: string, sql: string, params: unknown[] = []) => {
      await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
      try {
        return (await db.query<T>(sql, params)).rows;
      } finally {
        await db.exec("reset role;");
      }
    };
    // The agents of a deleted project are hidden too (their policy reads by workspace).
    await db.query("insert into agents (workspace_id, project_id, item_key, name) values ($1, $2, 'scorer-x', 'Scorer')", [ws, lead]);
    expect(await as(MORGAN, "select id from agents where project_id = $1", [lead])).toHaveLength(0);
    // Listed: Sam sees what he deleted; Morgan (Owner) sees it too; over 30 days isn't listed.
    expect((await as<{ name: string }>(SAM, "select name from list_deleted_projects($1)", [ws])).map((r) => r.name)).toEqual(["Lead scorer"]);
    expect((await as<{ name: string }>(MORGAN, "select name from list_deleted_projects($1)", [ws])).map((r) => r.name)).toEqual(["Lead scorer"]);
    // Permanent delete: Owner only.
    await expect(as(SAM, "select delete_project_forever($1)", [lead])).rejects.toThrow(/Only the workspace Owner/);
    // Restore: Sam can (he deleted it); then it's back.
    await as(SAM, "select restore_project($1)", [lead]);
    expect(await as(MORGAN, "select id from projects where id = $1", [lead])).toHaveLength(1);
    await expect(as(SAM, "select restore_project($1)", [prep])).rejects.toThrow(/can't be restored/);
    // Purge removes what's past 30 days, and returns it.
    const purged = await db.query<{ id: string }>("select id from purge_deleted_projects($1)", [ws]);
    expect(purged.rows.map((r) => r.id)).toEqual([prep]);
    expect(await count("select count(*) as n from projects where id = $1", [prep])).toBe(0);
    await expect(as(SAM, "select * from purge_deleted_projects($1)", [ws])).rejects.toThrow(/permission denied/);
  });
});

describe("M5.10: secrets in Vault, preferences, terminal sessions and analytics (0023)", () => {
  const as = async <T,>(user: string, sql: string, params: unknown[] = []) => {
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
    try {
      return (await db.query<T>(sql, params)).rows;
    } finally {
      await db.exec("reset role;");
    }
  };

  beforeAll(async () => {
    // An earlier test grants everything to signed-in users after the migrations ran. On Supabase that default grant
    // comes first and 0023's revokes follow, so replay them here in that order.
    const sql = readFileSync(join(MIGRATIONS, "0023_m510_pre_m6.sql"), "utf8");
    for (const line of sql.split("\n").filter((l) => l.startsWith("revoke "))) await db.exec(line);
  });

  it("keeps a workspace's Lyzr key in Vault, shows only its last 4, replaces and removes it, and nobody signed in can read it", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    await db.query("select set_workspace_secret($1, 'lyzr_api_key', 'sk-first-key-1234', $2, 'Morgan Lee')", [ws, MORGAN]);
    expect(await one("select last4 from workspace_secrets where workspace_id = $1", [ws])).toEqual({ last4: "1234" });
    expect(await one("select workspace_secret($1, 'lyzr_api_key') as v", [ws])).toEqual({ v: "sk-first-key-1234" });
    const vaultBefore = await count("select count(*) as n from vault.secrets");
    await db.query("select set_workspace_secret($1, 'lyzr_api_key', 'sk-second-key-9876', $2, 'Morgan Lee')", [ws, MORGAN]);
    expect(await one("select workspace_secret($1, 'lyzr_api_key') as v", [ws])).toEqual({ v: "sk-second-key-9876" });
    // The old secret is gone from Vault, not left behind.
    expect(await count("select count(*) as n from vault.secrets")).toBe(vaultBefore);
    // Even the workspace's Owner can't read the table or call the functions from the API.
    expect(await as(MORGAN, "select * from workspace_secrets")).toHaveLength(0);
    await expect(as(MORGAN, "select workspace_secret($1, 'lyzr_api_key')", [ws])).rejects.toThrow(/permission denied/);
    await db.query("select delete_workspace_secret($1, 'lyzr_api_key')", [ws]);
    expect(await count("select count(*) as n from vault.secrets")).toBe(vaultBefore - 1);
  });

  it("keeps a project key's value in Vault and drops it with the key", async () => {
    const { p } = await one<{ p: string }>("select id as p from projects where name = 'Meeting Prep' limit 1");
    const { k } = await one<{ k: string }>("insert into project_keys (project_id, name, environment, set_by_name) values ($1, 'SLACK_TOKEN', 'preview', 'Morgan') returning id as k", [p]);
    await db.query("select set_project_key_value($1, 'xoxb-test')", [k]);
    const { secret_id } = await one<{ secret_id: string }>("select secret_id from project_keys where id = $1", [k]);
    expect(await count("select count(*) as n from vault.secrets where id = $1", [secret_id])).toBe(1);
    await db.query("delete from project_keys where id = $1", [k]);
    expect(await count("select count(*) as n from vault.secrets where id = $1", [secret_id])).toBe(0);
  });

  it("lets a person read only their own preferences, and nobody read analytics through the API", async () => {
    await db.query("insert into user_preferences (user_id, panes) values ($1, '{\"parts\": \"closed\"}'), ($2, '{}')", [MORGAN, REVIEWER]);
    expect(await as<{ user_id: string }>(MORGAN, "select user_id from user_preferences")).toEqual([{ user_id: MORGAN }]);
    await db.query("insert into analytics_events (event, user_id, is_demo) values ('plan_written', $1, false)", [MORGAN]);
    // Supabase grants table access by default, so the revoke turns this into "permission denied"; either way, no rows.
    const read = await as(MORGAN, "select * from analytics_events").catch((e: Error) => e);
    expect(read instanceof Error ? read.message : read).toMatch(/permission denied/);
    await expect(db.query("insert into analytics_events (event) values ('clicked_anything')")).rejects.toThrow(/check/);
  });

  it("forgets Studio agents made on the platform's shared account", async () => {
    expect(await count("select count(*) as n from agents where lyzr_agent_id is not null")).toBe(0);
  });
});

describe("M6: MCP servers in Connections (0024)", () => {
  beforeAll(async () => {
    // Replay 0024's revokes after the earlier test's blanket grant, as on Supabase (see the 0023 block).
    const sql = readFileSync(join(MIGRATIONS, "0024_m6_mcp_connections.sql"), "utf8");
    for (const line of sql.split("\n").filter((l) => l.startsWith("revoke "))) await db.exec(line);
  });

  it("an MCP row needs an HTTPS URL, once per workspace; its auth header lives in Vault and goes with the row", async () => {
    const { ws } = await one<{ ws: string }>("select create_demo_workspace($1, 'morgan@example.com', 'Morgan Lee') as ws", [MORGAN]);
    await expect(db.query("insert into connections (workspace_id, provider, status, kind, name, url) values ($1, 'mcp', 'connected', 'mcp', 'Docs', 'http://docs.example.com/mcp')", [ws])).rejects.toThrow(/check/);
    const { c } = await one<{ c: string }>("insert into connections (workspace_id, provider, status, kind, name, url) values ($1, 'mcp', 'connected', 'mcp', 'Docs', 'https://docs.example.com/mcp') returning id as c", [ws]);
    await expect(db.query("insert into connections (workspace_id, provider, status, kind, name, url) values ($1, 'mcp', 'connected', 'mcp', 'Docs again', 'https://docs.example.com/mcp')", [ws])).rejects.toThrow(/unique|duplicate/);
    await db.query("select set_connection_secret($1, 'Bearer abc123')", [c]);
    expect(await one("select connection_secret($1) as v", [c])).toEqual({ v: "Bearer abc123" });
    const { auth_secret_id } = await one<{ auth_secret_id: string }>("select auth_secret_id from connections where id = $1", [c]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${MORGAN}';`);
    try {
      await expect(db.query("select connection_secret($1)", [c])).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role;");
    }
    await db.query("delete from connections where id = $1", [c]);
    expect(await count("select count(*) as n from vault.secrets where id = $1", [auth_secret_id])).toBe(0);
  });
});
