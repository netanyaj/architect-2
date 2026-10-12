-- M6: the tour's last two events, so the analytics query shows where people leave it.
--
-- tour_minimised: × on the tour card (detail 'card') or the guide shrunk to a dot ('guide').
-- tour_finished: the finish card closed ('explore', 'reset' or 'close').
-- Nothing else changes: the table, its RLS and its grants stay as 0023 made them.

alter table analytics_events drop constraint analytics_events_event_check;
alter table analytics_events add constraint analytics_events_event_check check (event in (
  'plan_written', 'build_started', 'blocker_resolved', 'launch', 'view_as_role', 'tour_step', 'tour_minimised', 'tour_finished',
  'demo_reset', 'demo_started'
));
