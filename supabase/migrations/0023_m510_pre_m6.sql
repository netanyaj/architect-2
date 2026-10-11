-- M5.10: fixes before M6 (docs/product/26-pre-m6-review-and-fixes.md).
--
-- 1. Each workspace's own Lyzr API key, encrypted at rest in Supabase Vault. Only the server (service role) can
--    write or read it; the browser only ever gets the last 4 characters. Owners and Admins are checked in the action.
-- 2. Project "Keys and passwords" values are now kept, encrypted in Vault, and never read back to anyone.
-- 3. Agents remember why their Studio agent couldn't be made ("Not in Studio yet · Retry").
--    Studio agents made on the platform's shared Lyzr account are forgotten here: from now on, an agent lives only
--    in its own workspace's Studio (the seeded Research agent is the one shared demo agent, handled in code).
-- 4. Per-person preferences: the Parts and Chat pane state, and the guided tour's progress.
-- 5. Developer panel terminal sessions, saved per project, read-only once ended.
-- 6. analytics_events: first-party product events, insert-only from the server; nobody can read them through the API.

-- Fail early if Vault is off (it's on by default on Supabase: Database › Extensions › supabase_vault).
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise exception 'Supabase Vault is off. Turn on supabase_vault in Database › Extensions, then run this again.';
  end if;
end;
$$;

-- 1. Workspace secrets (the Lyzr key) --------------------------------------------------------------------------
create table workspace_secrets (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (name in ('lyzr_api_key')),
  secret_id uuid not null,
  last4 text not null check (char_length(last4) <= 4),
  set_by uuid references auth.users(id) on delete set null,
  set_by_name text not null,
  set_at timestamptz not null default now(),
  primary key (workspace_id, name)
);
-- RLS on with no policies: only the service role reaches this table.
alter table workspace_secrets enable row level security;

create or replace function set_workspace_secret(p_workspace uuid, p_name text, p_value text, p_by uuid, p_by_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
  v_new uuid;
begin
  select secret_id into v_old from workspace_secrets where workspace_id = p_workspace and name = p_name;
  v_new := vault.create_secret(p_value, null, 'workspace ' || p_workspace::text || ' ' || p_name);
  insert into workspace_secrets (workspace_id, name, secret_id, last4, set_by, set_by_name, set_at)
  values (p_workspace, p_name, v_new, right(p_value, 4), p_by, p_by_name, now())
  on conflict (workspace_id, name) do update
    set secret_id = excluded.secret_id, last4 = excluded.last4, set_by = excluded.set_by, set_by_name = excluded.set_by_name, set_at = now();
  if v_old is not null then delete from vault.secrets where id = v_old; end if;
end;
$$;

create or replace function workspace_secret(p_workspace uuid, p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return (
    select d.decrypted_secret
    from workspace_secrets s join vault.decrypted_secrets d on d.id = s.secret_id
    where s.workspace_id = p_workspace and s.name = p_name
  );
end;
$$;

create or replace function delete_workspace_secret(p_workspace uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from workspace_secrets where workspace_id = p_workspace and name = p_name;
end;
$$;

-- 2. Project key values -----------------------------------------------------------------------------------------
alter table project_keys add column secret_id uuid;

create or replace function set_project_key_value(p_key uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
begin
  select secret_id into v_old from project_keys where id = p_key;
  update project_keys set secret_id = vault.create_secret(p_value, null, 'project key ' || p_key::text) where id = p_key;
  if v_old is not null then delete from vault.secrets where id = v_old; end if;
end;
$$;

-- A deleted key, project or workspace takes its Vault secret with it.
create or replace function drop_vault_secret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.secret_id is not null then delete from vault.secrets where id = old.secret_id; end if;
  return old;
end;
$$;
create trigger workspace_secrets_drop_vault after delete on workspace_secrets for each row execute function drop_vault_secret();
create trigger project_keys_drop_vault after delete on project_keys for each row execute function drop_vault_secret();

revoke execute on function set_workspace_secret(uuid, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function workspace_secret(uuid, text) from public, anon, authenticated;
revoke execute on function delete_workspace_secret(uuid, text) from public, anon, authenticated;
revoke execute on function set_project_key_value(uuid, text) from public, anon, authenticated;
revoke execute on function drop_vault_secret() from public, anon, authenticated;

-- 3. Agents and Studio ------------------------------------------------------------------------------------------
alter table agents add column studio_error text;
-- Agents made on the platform's Lyzr account so far: no workspace has its own key yet, so none of them belongs to
-- the workspace that uses it. Forget them; each workspace makes its own once it connects a key.
update agents set lyzr_agent_id = null, studio_synced_at = null where lyzr_agent_id is not null;

-- 4. Per-person preferences -------------------------------------------------------------------------------------
create table user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- {"parts": "open" | "closed", "chat": "open" | "closed"}: only panes the person has touched.
  panes jsonb not null default '{}',
  -- {"dismissed": bool, "done": ["plan", "build", ...]}
  tour jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table user_preferences enable row level security;
create policy user_preferences_own_read on user_preferences for select using (user_id = auth.uid());

-- 5. Terminal sessions ------------------------------------------------------------------------------------------
create table terminal_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  user_name text not null,
  lines jsonb not null default '[]',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table terminal_sessions enable row level security;
create policy terminal_sessions_read on terminal_sessions for select
  using (exists (select 1 from projects p where p.id = terminal_sessions.project_id and is_member(p.workspace_id)));
create index terminal_sessions_project_time on terminal_sessions (project_id, started_at desc);

-- 6. Analytics --------------------------------------------------------------------------------------------------
create table analytics_events (
  id bigint generated always as identity primary key,
  event text not null check (event in (
    'plan_written', 'build_started', 'blocker_resolved', 'launch', 'view_as_role', 'tour_step', 'demo_reset', 'demo_started'
  )),
  -- A short non-personal detail: a tour step key, a role name, an environment. Never prompt text or emails.
  detail text check (detail is null or char_length(detail) <= 40),
  user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);
-- RLS on with no policies, and no grants: only the service role inserts, and reading is done in the SQL editor.
alter table analytics_events enable row level security;
revoke all on analytics_events from anon, authenticated;
create index analytics_events_user_time on analytics_events (user_id, created_at);
