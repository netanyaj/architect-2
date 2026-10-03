-- Architect 2.0 prototype · initial schema
-- Every table is scoped to a workspace; RLS uses is_member().

create extension if not exists "pgcrypto";

-- Workspaces and people ---------------------------------------------------
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  governance_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  invited_email text,
  role text not null check (role in ('owner','admin','builder','viewer')),
  status text not null default 'active' check (status in ('invited','active')),
  created_at timestamptz not null default now(),
  check (user_id is not null or invited_email is not null)
);
create unique index members_user on members (workspace_id, user_id) where user_id is not null;
create unique index members_invite on members (workspace_id, lower(invited_email)) where user_id is null;

create or replace function is_member(ws uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from members m where m.workspace_id = ws and m.user_id = auth.uid() and m.status = 'active');
$$;

create or replace function can_build(ws uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from members m where m.workspace_id = ws and m.user_id = auth.uid()
                 and m.status = 'active' and m.role in ('owner','admin','builder'));
$$;

-- Projects and Blueprints ---------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  owner_id uuid references auth.users(id),
  status text not null default 'draft' check (status in ('draft','building','paused','built','live')),
  current_version int,
  budget_credits numeric,
  stack text not null default 'default',          -- 'default' or the imported stack
  repo_full_name text,
  model text not null default 'claude-sonnet',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table blueprints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version int not null,
  status text not null default 'draft' check (status in ('draft','agreed','superseded')),
  prompt text not null,
  summary text,
  total_low numeric, total_high numeric, total_likely numeric,
  est_minutes int,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  agreed_at timestamptz,                             -- set ONLY when the user clicks Build or Apply
  unique (project_id, version)
);

create table items (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references blueprints(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  key text not null,                                 -- stable across versions, e.g. 'last-email-thread'
  grp text not null check (grp in ('features','data','integrations','agents','quality')),
  title text not null,
  description text,
  proved_when text not null,                         -- the check, in plain words
  source_quote text,                                 -- the prompt text it came from
  status text not null default 'proposed' check (status in
    ('proposed','agreed','building','built','sample_data','needs_connection','needs_approval','failed','paused','deferred','dropped')),
  status_detail text,                                -- 'Fixing 1/3', 'IT admin reviews', 'You chose: only me'
  drop_reason text,
  estimate_low numeric, estimate_high numeric, estimate_likely numeric,
  confidence text check (confidence in ('low','medium','high')),
  cost_actual numeric not null default 0,
  fix_attempts int not null default 0,
  position int not null default 0,
  unique (blueprint_id, key)
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references blueprints(id) on delete cascade,
  text text not null,
  affects text[] not null default '{}',             -- item keys
  options jsonb not null,                            -- [{label, value}]
  recommended text not null,
  answer text,
  blocking boolean not null default false,           -- blocking questions hold the Build button
  answered_at timestamptz
);

create table defaults (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references blueprints(id) on delete cascade,
  label text not null, value text not null, alternatives jsonb not null default '[]'
);

-- Proof -------------------------------------------------------------------
create table checks (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  kind text not null check (kind in ('ui_test','api_test','type_check','http','eval','rubric')),
  description text not null,
  written_by text not null default 'verifier',
  written_at timestamptz not null default now(),     -- always before the item's first build event
  locked boolean not null default true
);

create table proofs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  check_id uuid references checks(id),
  attempt int not null default 0,                    -- 0 = first build, 1..3 = fixes
  result text not null check (result in ('pass','fail')),
  assertions_passed int, assertions_total int,
  summary text, screenshot_url text, log text,
  created_at timestamptz not null default now()
);

-- Runs, events, usage -----------------------------------------------------
create table runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  blueprint_id uuid references blueprints(id),
  kind text not null check (kind in ('build','fix','change','deploy')),
  status text not null default 'queued' check (status in ('queued','running','paused_budget','paused_item','done','failed')),
  scenario text not null default 'meeting-prep',
  started_by uuid references auth.users(id),          -- never null for build/change: a person clicked
  started_at timestamptz, finished_at timestamptz
);

create table events (                                -- Realtime source for the workspace
  id bigserial primary key,
  project_id uuid not null references projects(id) on delete cascade,
  run_id uuid references runs(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  type text not null,                                -- see docs/SIMULATOR.md
  actor text not null check (actor in ('architect_agent','verifier','coding_agent','user','system')),
  actor_label text,                                  -- 'Coding agent: Claude Code (Sam)'
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table usage_ledger (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  run_id uuid references runs(id), item_id uuid references items(id),
  kind text not null check (kind in ('build','fix','change','running','blueprint')),
  credits numeric not null,
  note text,
  created_at timestamptz not null default now()
);

-- Conversation --------------------------------------------------------------
create table messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  role text not null check (role in ('user','architect','system')),
  mode text not null default 'build' check (mode in ('build','plan')),
  content text not null,
  model text,
  status text not null default 'done' check (status in ('queued','running','done')),
  attachments uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table change_proposals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  diff jsonb not null,                               -- {add:[item], change:[{key, from, to}], remove:[key]}
  estimate_likely numeric, est_minutes int,
  conflict jsonb,                                    -- conflict-guard card, if any
  status text not null default 'proposed' check (status in ('proposed','applied','discarded')),
  created_at timestamptz not null default now()
);

create table files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('upload','blueprint','generated')),
  path text not null, storage_path text,
  used_by text[] not null default '{}',              -- item keys
  created_at timestamptz not null default now()
);

-- Connections, environments, deploys --------------------------------------
create table connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,                            -- gmail, google_calendar, slack, hubspot, github
  status text not null check (status in ('connected','expired','missing')),
  scopes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table environments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (name in ('preview','staging','production')),
  url text, status text not null default 'idle',
  unique (project_id, name)
);

create table deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  environment text not null,
  blueprint_version int not null,
  status text not null check (status in ('checking','blocked','deploying','live','rolled_back')),
  checks jsonb not null default '[]',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Agents and repos ----------------------------------------------------------
create table agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  item_key text,
  name text not null,
  framework text not null default 'lyzr' check (framework in ('lyzr','crewai','langgraph')),
  model text not null default 'claude-sonnet',
  instructions text, tools text[] not null default '{}', schedule text,
  studio_synced_at timestamptz
);

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  input jsonb, tool_calls jsonb, output text,
  duration_ms int, credits numeric,
  status text not null check (status in ('passed','failed','running')),
  created_at timestamptz not null default now()
);

create table repo_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  full_name text not null, branch text not null default 'main', folder text not null default '/',
  analysis jsonb,                                    -- stack, run commands, secrets, tests, agents
  created_at timestamptz not null default now()
);

-- Governance (simulated) ----------------------------------------------------
create table policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('location','models','connectors','egress','budget','permission')),
  config jsonb not null
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  kind text not null check (kind in ('connector','deploy','token','budget')),
  title text not null,
  requested_by uuid references auth.users(id),
  payload jsonb not null default '{}',
  status text not null default 'waiting' check (status in ('waiting','approved','rejected')),
  decided_by uuid references auth.users(id), reason text, decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor text not null, action text not null, target text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table support_tickets (
  id bigserial primary key,                          -- shown to the user as the ticket ID
  user_id uuid references auth.users(id),
  project_id uuid references projects(id),
  question text not null, transcript jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

-- RLS -----------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['projects','connections','usage_ledger','agents','policies','approvals','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (is_member(workspace_id))', t||'_read', t);
  end loop;
end $$;

alter table workspaces enable row level security;
create policy workspaces_read on workspaces for select using (is_member(id));
alter table members enable row level security;
create policy members_read on members for select using (is_member(workspace_id));

-- project-scoped tables read through their project
do $$
declare t text;
begin
  foreach t in array array['blueprints','items','runs','events','messages','change_proposals','files','environments','deployments','repo_imports'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (exists (select 1 from projects p where p.id = %I.project_id and is_member(p.workspace_id)))', t||'_read', t, t);
  end loop;
end $$;

-- tables scoped through a blueprint or item
alter table questions enable row level security;
create policy questions_read on questions for select using (exists (select 1 from blueprints b join projects p on p.id = b.project_id where b.id = questions.blueprint_id and is_member(p.workspace_id)));
alter table defaults enable row level security;
create policy defaults_read on defaults for select using (exists (select 1 from blueprints b join projects p on p.id = b.project_id where b.id = defaults.blueprint_id and is_member(p.workspace_id)));
alter table checks enable row level security;
create policy checks_read on checks for select using (exists (select 1 from items i join projects p on p.id = i.project_id where i.id = checks.item_id and is_member(p.workspace_id)));
alter table proofs enable row level security;
create policy proofs_read on proofs for select using (exists (select 1 from items i join projects p on p.id = i.project_id where i.id = proofs.item_id and is_member(p.workspace_id)));
alter table agent_runs enable row level security;
create policy agent_runs_read on agent_runs for select using (exists (select 1 from agents a where a.id = agent_runs.agent_id and is_member(a.workspace_id)));
alter table support_tickets enable row level security;
create policy tickets_own on support_tickets for select using (user_id = auth.uid());

-- Writes go through server actions using the service role, which checks can_build()
-- before any build, change, deploy or approval. Viewers can read and comment only.

alter publication supabase_realtime add table events, items, runs, approvals;
