-- M5 Approvals (C-5, C-10), simulated: an Owner or Admin decides each request on screen 11, and "Approve and allow
-- everywhere" (or "for this project from now on") records an allow-rule, so later requests of the same kind don't
-- wait. Rules are kept, never deleted: removing one sets removed_at, and both are audited by the server.

create table allow_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  action text not null check (action in ('connector', 'production_deploy', 'push_to_main')),
  project_id uuid references projects(id) on delete cascade,  -- null: every project in the workspace
  target text,                                                -- the service, for a connector rule
  approval_id uuid references approvals(id) on delete set null,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index allow_rules_workspace on allow_rules (workspace_id) where removed_at is null;
alter table allow_rules enable row level security;
create policy allow_rules_read on allow_rules for select using (is_member(workspace_id));

-- Who decided, by name, for the Decided tab and the project that asked.
alter table approvals add column decided_by_name text;

-- settle_run (as in 0008), with one change: a service the policy denies files one request per project, not one
-- per workspace, and the request says which part asked and why, so the admin can decide it for that project.
create or replace function settle_run(p_run uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run runs%rowtype;
  v_project projects%rowtype;
  o jsonb;
  f jsonb;
  a jsonb;
  v_item items%rowtype;
  v_check uuid;
  v_status text;
  v_build numeric := 0;
  v_parts int := 0;
  v_fixes int;
  v_title text;
begin
  select * into v_run from runs where id = p_run for update;
  if not found then raise exception 'run_not_found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' then return v_run.status; end if;
  if v_run.ends_at is null or v_run.ends_at > now() then return v_run.status; end if;
  select * into v_project from projects where id = v_run.project_id for update;

  for o in select * from jsonb_array_elements(coalesce(v_run.outcome -> 'outcomes', '[]'::jsonb)) loop
    select * into v_item from items where blueprint_id = v_run.blueprint_id and key = o ->> 'key';
    continue when not found;
    v_fixes := jsonb_array_length(coalesce(o -> 'fixes', '[]'::jsonb));

    -- Connected while the build played: the part works with real data rather than waiting.
    if o ->> 'status' = 'needs_connection' and exists (
      select 1 from connections c where c.workspace_id = v_project.workspace_id and c.provider = o ->> 'provider' and c.status = 'connected'
    ) then
      o := o || '{"status": "built", "statusDetail": null}'::jsonb;
    end if;

    update items set
      status = o ->> 'status',
      status_detail = o ->> 'statusDetail',
      cost_actual = cost_actual + (o ->> 'credits')::numeric
        + coalesce((select sum((x ->> 'credits')::numeric) from jsonb_array_elements(o -> 'fixes') x), 0),
      fix_attempts = fix_attempts + v_fixes
    where id = v_item.id;

    if (o ->> 'credits')::numeric > 0 then
      v_build := v_build + (o ->> 'credits')::numeric;
      v_parts := v_parts + 1;
    end if;

    select id into v_check from checks where item_id = v_item.id order by written_at desc limit 1;
    if v_check is not null and (o -> 'proof' is not null and o -> 'proof' <> 'null'::jsonb or v_fixes > 0) then
      if v_fixes > 0 and v_run.kind <> 'fix' then
        insert into proofs (item_id, check_id, attempt, result, summary)
        values (v_item.id, v_check, 0, 'fail', 'Failed: ' || coalesce(v_run.outcome -> 'failure' ->> 'measured', 'check failed'));
      end if;
      for a in select * from jsonb_array_elements(coalesce(o -> 'attempts', '[]'::jsonb)) loop
        insert into proofs (item_id, check_id, attempt, result, assertions_passed, assertions_total, summary, log)
        values (v_item.id, v_check, (a ->> 'attempt')::int, a ->> 'result',
                case when a ->> 'result' = 'pass' then (o -> 'proof' -> 'assertions' ->> 0)::int end,
                case when a ->> 'result' = 'pass' then (o -> 'proof' -> 'assertions' ->> 1)::int end,
                case when a ->> 'result' = 'pass' then 'All assertions passed' else 'Failed: ' || coalesce(a ->> 'measured', 'check failed') end,
                a ->> 'note');
      end loop;
      if v_fixes = 0 and o -> 'proof' is not null and o -> 'proof' <> 'null'::jsonb then
        insert into proofs (item_id, check_id, attempt, result, assertions_passed, assertions_total, summary, screenshot_url)
        values (v_item.id, v_check, 0, 'pass', (o -> 'proof' -> 'assertions' ->> 0)::int, (o -> 'proof' -> 'assertions' ->> 1)::int,
                'All assertions passed',
                case when (o -> 'proof' ->> 'screenshot')::boolean then '/preview/meeting-prep/today' end);
      end if;
    end if;

    for f in select * from jsonb_array_elements(coalesce(o -> 'fixes', '[]'::jsonb)) loop
      insert into usage_ledger (workspace_id, project_id, run_id, item_id, kind, credits, note)
      values (v_project.workspace_id, v_project.id, v_run.id, v_item.id, 'fix', (f ->> 'credits')::numeric,
              'Fix · ' || v_item.title || case when (f ->> 'attempt')::int > 3 then ', one more try' else ', try ' || (f ->> 'attempt') || ' of 3' end);
    end loop;

    if o ->> 'status' = 'needs_approval' and not exists (
      select 1 from approvals ap where ap.workspace_id = v_project.workspace_id and ap.project_id = v_project.id
        and ap.kind = 'connector' and ap.status = 'waiting' and ap.payload ->> 'provider' = o ->> 'provider'
    ) then
      v_title := initcap(replace(coalesce(o ->> 'provider', 'service'), '_', ' ')) || ' connector';
      insert into approvals (workspace_id, project_id, kind, title, requested_by, payload)
      values (v_project.workspace_id, v_project.id, 'connector', v_title, v_run.started_by,
              jsonb_build_object('provider', o ->> 'provider', 'item_key', o ->> 'key', 'project', v_project.name,
                                 'item_title', v_item.title, 'why', v_item.description,
                                 'requested_by_name', (select coalesce(m.display_name, split_part(m.email, '@', 1)) from members m
                                                       where m.workspace_id = v_project.workspace_id and m.user_id = v_run.started_by limit 1)));
    end if;
  end loop;

  if v_build > 0 then
    insert into usage_ledger (workspace_id, project_id, run_id, kind, credits, note)
    values (v_project.workspace_id, v_project.id, v_run.id, case v_run.kind when 'change' then 'change' else 'build' end, v_build,
            case v_run.kind when 'change' then 'Change' else 'Build' end || ' · ' || v_parts || case v_parts when 1 then ' part' else ' parts' end);
  end if;

  v_status := coalesce(v_run.outcome ->> 'status', 'done');
  update runs set status = v_status, finished_at = now() where id = v_run.id;
  update projects set
    status = case
      when v_status <> 'done' then 'paused'
      when exists (select 1 from items i where i.blueprint_id = v_run.blueprint_id and i.status = 'paused') then 'paused'
      when exists (select 1 from deployments d where d.project_id = v_project.id and d.status = 'live') then 'live'
      else 'built' end,
    updated_at = now()
  where id = v_project.id;
  insert into audit_log (workspace_id, actor, action, target, details)
  values (v_project.workspace_id, 'system', 'run.settled', v_project.name,
          jsonb_build_object('run', v_run.id, 'kind', v_run.kind, 'status', v_status, 'credits', v_build));
  return v_status;
end;
$$;
revoke execute on function settle_run(uuid) from public, anon, authenticated;

-- Reset demo data re-seeds the policies, so rules made from earlier approvals go with them (as in 0004, plus that).
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
  delete from allow_rules where workspace_id = p_workspace;
$$;
revoke execute on function apply_seed_updates(uuid) from public, anon, authenticated;
