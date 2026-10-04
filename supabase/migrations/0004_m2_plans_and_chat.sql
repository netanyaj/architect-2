-- Architect 2.0 prototype · M2: plans (Blueprints) written by the model, the Build gate, chat and uploads.
-- Additive: new columns, a bucket, two functions. Writes still go through server actions.

-- Parts: what the estimator and the UI need -------------------------------------------------
alter table items
  add column item_class text,
  add column size text check (size in ('s', 'm', 'l')),
  add column provider text,
  add column framework text check (framework in ('lyzr', 'crewai', 'langgraph')),
  add column est_seconds int,
  add column cost_driver text,
  add column edited_at timestamptz;                  -- the person changed its wording

-- Plans: generation state, name, what was left out, which model wrote it -----------------------
alter table blueprints
  add column name text,
  add column not_in_this_version jsonb not null default '[]',
  add column model text,
  add column simulated_model boolean not null default false,  -- answered by Gemini in place of the chosen model
  add column generation text not null default 'ready' check (generation in ('writing', 'ready', 'failed')),
  add column error_kind text check (error_kind in ('rate_limited', 'invalid', 'unavailable')),
  add column error text,
  add column drafting_credits numeric,
  add column based_on int;                           -- the version it was changed from (Apply), for compare

alter table questions
  add column position int not null default 0,
  add column answered_by uuid references auth.users(id);

alter table defaults add column position int not null default 0;

alter table change_proposals
  add column reply text,                             -- what Architect said with the card
  add column version_created int,
  add column decided_by uuid references auth.users(id),
  add column decided_at timestamptz;

alter table files
  add column name text,
  add column mime text,
  add column size_bytes int,
  add column extracted_text text,                    -- PDFs: text from the first 20 pages
  add column uploaded_by uuid references auth.users(id);

-- One plan is written at a time per project.
create unique index blueprints_one_writing on blueprints (project_id) where generation = 'writing';

-- The plan streams into the page through Realtime (and chat updates arrive the same way).
alter publication supabase_realtime add table blueprints, questions, messages, change_proposals;

-- Uploads: a private bucket. Files go in and out through the server only (no client policies).
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, 20971520)
on conflict (id) do nothing;

-- OpenRouter's free models are allowed alongside Claude, GPT and Gemini (BL-3) -------------------------
update policies
set config = jsonb_set(config, '{allowed}', (config->'allowed') || '["openrouter"]'::jsonb)
where kind = 'models' and not (config->'allowed') ? 'openrouter';

-- Changes to the seeded demo since 0002, applied after every seed (first sign-in and Reset demo data alike).
create or replace function apply_seed_updates(p_workspace uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update audit_log set target = (select name from workspaces where id = p_workspace)
  where workspace_id = p_workspace and action = 'workspace.seeded' and target = 'Acme Ops';
  update policies set config = '{"allowed": ["claude", "gpt", "gemini", "openrouter"]}'
  where workspace_id = p_workspace and kind = 'models';
$$;
revoke execute on function apply_seed_updates(uuid) from public, anon, authenticated;

create or replace function create_demo_workspace(p_user uuid, p_email text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
begin
  perform pg_advisory_xact_lock(hashtext('create_demo_workspace:' || p_user::text));

  select m.workspace_id into v_workspace
  from members m
  where m.user_id = p_user and m.role = 'owner' and m.status = 'active'
  order by m.created_at
  limit 1;
  if v_workspace is not null then
    return v_workspace;
  end if;

  insert into workspaces (name) values (workspace_name_for(p_name, p_email)) returning id into v_workspace;
  insert into members (workspace_id, user_id, email, display_name, role, status, invite_token, accepted_at)
  values (v_workspace, p_user, p_email, p_name, 'owner', 'active', null, now());
  perform seed_demo_workspace(v_workspace, p_user);
  perform apply_seed_updates(v_workspace);
  return v_workspace;
end;
$$;
revoke execute on function create_demo_workspace(uuid, text, text) from public, anon, authenticated;

create or replace function reset_demo_workspace(p_workspace uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not exists (
    select 1 from members m
    where m.workspace_id = p_workspace and m.user_id = p_owner and m.role = 'owner' and m.status = 'active'
  ) then
    raise exception 'Only the workspace owner can reset demo data' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('reset_demo_workspace:' || p_workspace::text));
  select name into v_name from workspaces where id = p_workspace;

  update support_tickets set project_id = null
  where project_id in (select id from projects where workspace_id = p_workspace);

  delete from usage_ledger where workspace_id = p_workspace;
  delete from approvals where workspace_id = p_workspace;
  delete from agents where workspace_id = p_workspace;
  delete from projects where workspace_id = p_workspace;
  delete from connections where workspace_id = p_workspace;
  delete from policies where workspace_id = p_workspace;
  delete from members
  where workspace_id = p_workspace and user_id is null
    and lower(invited_email) in ('sam@acme-ops.example', 'jordan@acme-ops.example');

  perform seed_demo_workspace(p_workspace, p_owner);
  perform apply_seed_updates(p_workspace);

  insert into audit_log (workspace_id, actor, action, target, details)
  values (p_workspace, p_owner::text, 'workspace.reset', v_name, '{"note": "Demo data reset from Settings"}');
end;
$$;
revoke execute on function reset_demo_workspace(uuid, uuid) from public, anon, authenticated;

-- The Build gate (DATA-MODEL rule 1) --------------------------------------------------------------
-- Only a person's click runs this. In one transaction it checks that they can build, every blocking question is
-- answered and the estimate fits the budget; then it agrees the plan (agreed_at), agrees its parts, supersedes
-- older versions and queues a build run started by that person. The simulator (M3) plays queued runs.
create or replace function agree_and_build(p_blueprint uuid, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bp blueprints%rowtype;
  v_project projects%rowtype;
  v_spent numeric;
  v_run uuid;
begin
  select * into v_bp from blueprints where id = p_blueprint for update;
  if not found then raise exception 'plan_not_found' using errcode = 'P0002'; end if;
  select * into v_project from projects where id = v_bp.project_id for update;

  if not exists (
    select 1 from members m where m.workspace_id = v_project.workspace_id and m.user_id = p_user
      and m.status = 'active' and m.role in ('owner', 'admin', 'builder')
  ) then
    raise exception 'cannot_build' using errcode = '42501';
  end if;
  if v_bp.generation <> 'ready' then raise exception 'plan_not_ready'; end if;
  if v_bp.agreed_at is not null then raise exception 'already_agreed'; end if;
  if exists (select 1 from questions q where q.blueprint_id = p_blueprint and q.blocking and q.answer is null) then
    raise exception 'blocking_questions_open';
  end if;
  if v_project.budget_credits is not null then
    select coalesce(sum(credits), 0) into v_spent from usage_ledger where project_id = v_project.id;
    if v_spent + coalesce(v_bp.total_likely, 0) > v_project.budget_credits then
      raise exception 'over_budget';
    end if;
  end if;

  update blueprints set status = 'superseded' where project_id = v_project.id and id <> p_blueprint and status <> 'superseded';
  update blueprints set status = 'agreed', agreed_at = now() where id = p_blueprint;
  update items set status = 'agreed' where blueprint_id = p_blueprint and status = 'proposed';
  update projects set status = 'building', current_version = v_bp.version, updated_at = now() where id = v_project.id;
  insert into runs (project_id, blueprint_id, kind, status, started_by)
  values (v_project.id, p_blueprint, 'build', 'queued', p_user)
  returning id into v_run;
  insert into audit_log (workspace_id, actor, action, target, details)
  values (v_project.workspace_id, p_user::text, 'plan.agreed', v_project.name,
          jsonb_build_object('version', v_bp.version, 'run', v_run, 'estimate', v_bp.total_likely));
  return v_run;
end;
$$;
revoke execute on function agree_and_build(uuid, uuid) from public, anon, authenticated;
