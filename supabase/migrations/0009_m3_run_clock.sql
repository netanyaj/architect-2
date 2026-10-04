-- M3: the database's clock is the run's clock. A run's start and end are stamped with now() here, so settling
-- (which compares ends_at with now()) agrees with the timeline whatever the app server's clock says. Browsers
-- replay against db_now(), read with the page.

create or replace function begin_run(p_run uuid, p_variant text, p_speed numeric, p_scenario text)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update runs set status = 'running', started_at = now(), variant = p_variant, speed = p_speed, scenario = p_scenario
  where id = p_run and status = 'queued'
  returning started_at;
$$;

create or replace function set_run_timeline(p_run uuid, p_duration_ms int, p_outcome jsonb)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  update runs set ends_at = started_at + make_interval(secs => p_duration_ms / 1000.0), outcome = p_outcome
  where id = p_run and status = 'running'
  returning ends_at;
$$;

create or replace function db_now() returns timestamptz language sql stable as $$ select now() $$;

revoke execute on function begin_run(uuid, text, numeric, text) from public, anon, authenticated;
revoke execute on function set_run_timeline(uuid, int, jsonb) from public, anon, authenticated;
revoke execute on function db_now() from public, anon, authenticated;
