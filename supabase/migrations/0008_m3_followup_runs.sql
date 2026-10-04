-- M3: follow-up runs on an agreed plan, each started by a click (SIMULATOR step 4):
-- Raise budget and continue ('build', every part still waiting) and Try once more ('fix', one Blocked part).
-- Same checks as the Build gate: role, one run at a time, and the budget.

create or replace function start_followup_run(p_project uuid, p_user uuid, p_kind text, p_focus jsonb, p_estimate numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects%rowtype;
  v_bp blueprints%rowtype;
  v_spent numeric;
  v_run uuid;
begin
  if p_kind not in ('build', 'fix') then raise exception 'bad_run_kind'; end if;
  select * into v_project from projects where id = p_project for update;
  if not found then raise exception 'project_not_found' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from members m where m.workspace_id = v_project.workspace_id and m.user_id = p_user
      and m.status = 'active' and m.role in ('owner', 'admin', 'builder')
  ) then
    raise exception 'cannot_build' using errcode = '42501';
  end if;
  select * into v_bp from blueprints where project_id = p_project and agreed_at is not null order by version desc limit 1;
  if not found then raise exception 'plan_not_agreed'; end if;
  if exists (select 1 from runs r where r.project_id = p_project and r.status in ('queued', 'running')) then
    raise exception 'run_in_progress';
  end if;
  if v_project.budget_credits is not null then
    select coalesce(sum(credits), 0) into v_spent from usage_ledger where project_id = p_project;
    if v_spent + coalesce(p_estimate, 0) > v_project.budget_credits then raise exception 'over_budget'; end if;
  end if;

  update projects set status = 'building', updated_at = now() where id = p_project;
  insert into runs (project_id, blueprint_id, kind, status, started_by, outcome)
  values (p_project, v_bp.id, p_kind, 'queued', p_user, jsonb_build_object('focus', coalesce(p_focus, 'null'::jsonb)))
  returning id into v_run;
  insert into audit_log (workspace_id, actor, action, target, details)
  values (v_project.workspace_id, p_user::text, case p_kind when 'fix' then 'part.retried' else 'build.continued' end, v_project.name,
          jsonb_build_object('run', v_run, 'focus', p_focus, 'estimate', p_estimate));
  return v_run;
end;
$$;
revoke execute on function start_followup_run(uuid, uuid, text, jsonb, numeric) from public, anon, authenticated;

-- Settling a retry adds to a part's fix count rather than replacing it, and names the extra try plainly.
-- A part whose service was connected while the build played settles as working.
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
