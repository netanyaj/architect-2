-- M3: the build simulator (docs/SIMULATOR.md).
-- A run's whole timeline is computed when it starts; its events are inserted with payload.at_ms, and its final
-- state is kept on the run so settling is one idempotent transaction.

alter table runs add column variant text not null default 'default' check (variant in ('default', 'paused', 'budget'));
alter table runs add column speed numeric not null default 1 check (speed > 0 and speed <= 1);
alter table runs add column ends_at timestamptz;           -- started_at + the timeline's length
alter table runs add column outcome jsonb;                 -- final statuses, costs and proofs, applied by settle_run

create index if not exists events_run on events (run_id, id);
create index if not exists events_project on events (project_id, id);
create index if not exists runs_project on runs (project_id, started_at desc);

-- The Build gate takes the run's kind: 'build' (Build · ~N credits) or 'change' (Apply after a build).
-- A change is checked against the budget for the parts it will build, not the whole plan.
drop function if exists agree_and_build(uuid, uuid);
create or replace function agree_and_build(p_blueprint uuid, p_user uuid, p_kind text default 'build')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bp blueprints%rowtype;
  v_project projects%rowtype;
  v_spent numeric;
  v_cost numeric;
  v_run uuid;
begin
  if p_kind not in ('build', 'change') then raise exception 'bad_run_kind'; end if;
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
  if exists (select 1 from runs r where r.project_id = v_project.id and r.status in ('queued', 'running')) then
    raise exception 'run_in_progress';
  end if;
  if v_project.budget_credits is not null then
    select coalesce(sum(credits), 0) into v_spent from usage_ledger where project_id = v_project.id;
    if p_kind = 'change' then
      select coalesce(sum(estimate_likely), 0) into v_cost from items where blueprint_id = p_blueprint and status in ('proposed', 'agreed');
    else
      v_cost := coalesce(v_bp.total_likely, 0);
    end if;
    if v_spent + v_cost > v_project.budget_credits then
      raise exception 'over_budget';
    end if;
  end if;

  update blueprints set status = 'superseded' where project_id = v_project.id and id <> p_blueprint and status <> 'superseded';
  update blueprints set status = 'agreed', agreed_at = now() where id = p_blueprint;
  update items set status = 'agreed' where blueprint_id = p_blueprint and status = 'proposed';
  update projects set status = 'building', current_version = v_bp.version, updated_at = now() where id = v_project.id;
  insert into runs (project_id, blueprint_id, kind, status, started_by)
  values (v_project.id, p_blueprint, p_kind, 'queued', p_user)
  returning id into v_run;
  insert into audit_log (workspace_id, actor, action, target, details)
  values (v_project.workspace_id, p_user::text, case p_kind when 'change' then 'change.agreed' else 'plan.agreed' end, v_project.name,
          jsonb_build_object('version', v_bp.version, 'run', v_run, 'estimate', coalesce(v_cost, v_bp.total_likely)));
  return v_run;
end;
$$;
revoke execute on function agree_and_build(uuid, uuid, text) from public, anon, authenticated;

-- Settling (SIMULATOR step 3): once a running run's timeline is over, write its parts' final statuses, proofs,
-- Usage lines, approvals and the run's status, in one transaction. Safe to call any number of times: only the
-- first call after ends_at does anything; the others return the run's status.
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

    update items set
      status = o ->> 'status',
      status_detail = o ->> 'statusDetail',
      cost_actual = cost_actual + (o ->> 'credits')::numeric
        + coalesce((select sum((x ->> 'credits')::numeric) from jsonb_array_elements(o -> 'fixes') x), 0),
      fix_attempts = v_fixes
    where id = v_item.id;

    if (o ->> 'credits')::numeric > 0 then
      v_build := v_build + (o ->> 'credits')::numeric;
      v_parts := v_parts + 1;
    end if;

    -- Proofs: the first build (attempt 0) and each fix, against the check written before the code.
    select id into v_check from checks where item_id = v_item.id order by written_at desc limit 1;
    if v_check is not null and (o -> 'proof' is not null and o -> 'proof' <> 'null'::jsonb or v_fixes > 0) then
      if v_fixes > 0 then
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

    -- Each fix is its own Usage line (A-9).
    for f in select * from jsonb_array_elements(coalesce(o -> 'fixes', '[]'::jsonb)) loop
      insert into usage_ledger (workspace_id, project_id, run_id, item_id, kind, credits, note)
      values (v_project.workspace_id, v_project.id, v_run.id, v_item.id, 'fix', (f ->> 'credits')::numeric,
              'Fix · ' || v_item.title || ', try ' || (f ->> 'attempt') || ' of 3');
    end loop;

    -- A service the workspace's policy denies goes to the IT admin's approval queue (once).
    if o ->> 'status' = 'needs_approval' and not exists (
      select 1 from approvals ap where ap.workspace_id = v_project.workspace_id and ap.kind = 'connector'
        and ap.status = 'waiting' and ap.payload ->> 'provider' = o ->> 'provider'
    ) then
      v_title := initcap(replace(coalesce(o ->> 'provider', 'service'), '_', ' ')) || ' connector';
      insert into approvals (workspace_id, project_id, kind, title, requested_by, payload)
      values (v_project.workspace_id, v_project.id, 'connector', v_title, v_run.started_by,
              jsonb_build_object('provider', o ->> 'provider', 'item_key', o ->> 'key', 'project', v_project.name));
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
