-- Usage per person (M5.10). Run in Supabase › SQL Editor. Reads analytics_events, which nobody can read through the API.
-- One row per person: their first and last event, demo or not, and how far into the story they got.
-- Events: plan_written, build_started, blocker_resolved, launch, view_as_role, tour_step, demo_reset, demo_started.
-- No personal content is stored: users are ids (anonymous demo users included), details are short labels.

select
  e.user_id,
  bool_or(e.is_demo)                                                     as demo_user,
  min(e.created_at)                                                      as first_seen,
  max(e.created_at)                                                      as last_seen,
  count(*) filter (where e.event = 'plan_written')                       as plans_written,
  count(*) filter (where e.event = 'build_started')                      as builds_started,
  count(*) filter (where e.event = 'blocker_resolved')                   as blockers_resolved,
  count(*) filter (where e.event = 'launch')                             as launches,
  count(*) filter (where e.event = 'view_as_role')                       as viewed_as_role,
  count(distinct e.detail) filter (where e.event = 'tour_step')          as tour_steps_opened,
  count(*) filter (where e.event = 'demo_reset')                         as demo_resets,
  -- The three success metrics (README): time to first plan, plans built, blockers resolved before Launch.
  extract(epoch from (min(e.created_at) filter (where e.event = 'plan_written') - min(e.created_at))) / 60
                                                                         as minutes_to_first_plan,
  count(distinct e.project_id) filter (where e.event = 'build_started')
    :: numeric / nullif(count(distinct e.project_id) filter (where e.event = 'plan_written'), 0)
                                                                         as share_of_plans_built
from analytics_events e
group by e.user_id
order by last_seen desc;

-- Totals per day, demo visitors and signed-in people apart:
-- select date_trunc('day', created_at) as day, is_demo, event, count(*) from analytics_events group by 1, 2, 3 order by 1 desc, 2, 3;
