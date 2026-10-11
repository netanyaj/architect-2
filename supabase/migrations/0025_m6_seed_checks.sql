-- M6: the seed's checks say what they check.
--
-- Every seeded part's check read "Done when <its title> passes its check", which says nothing. Each now says what the
-- automatic check proves, in one plain sentence. Applied by apply_seed_updates (new workspaces and Reset demo data),
-- and once here for the demo workspaces that already exist. Only rows still holding the placeholder are changed.

create table seed_checks (key text primary key, proved_when text not null);
insert into seed_checks (key, proved_when) values
  -- Meeting Prep
  ('calendar-events-read', 'Every meeting in the next 24 hours is read, with its attendees and start time'),
  ('last-email-thread-per-attendee', 'Each attendee''s most recent email thread is found, or the brief says there is none'),
  ('agenda-pdf-summarised', 'An attached agenda PDF becomes a summary of five lines or fewer'),
  ('talking-points', 'Each brief ends with exactly three talking points'),
  ('brief-before-each-meeting', 'A brief is ready 30 minutes before each meeting and names every attendee'),
  ('slack-delivery', 'The brief arrives as a Slack message to the meeting''s organiser'),
  ('brief-writer', 'The brief is under 200 words and uses only facts from the threads and the agenda'),
  ('research-agent-yours-', 'Each attendee gets their company and last thread, or a note saying what is missing'),
  ('meeting-list', 'Today''s meetings are listed in time order with their attendees'),
  ('brief-page', 'Opening a meeting shows its brief, its sources and when it was written'),
  ('sign-in', 'Only people at your company''s domain can sign in'),
  ('error-alerts', 'A failed brief alerts the owner within 5 minutes'),
  -- ticket-triage
  ('new-tickets-read', 'Each new Zendesk ticket is read within a minute of arriving'),
  ('urgency-and-team-label', 'Every ticket gets exactly one urgency and one team'),
  ('draft-reply-for-simple-tickets', 'Simple tickets get a draft reply under 120 words; nothing is sent without a person'),
  ('vip-escalation', 'Tickets from VIP accounts are flagged urgent and assigned to a lead'),
  ('slack-alert-to-the-team', 'Urgent tickets post to the team''s Slack channel within a minute'),
  ('production-deploy', 'The Live version passes its checklist before it serves traffic'),
  -- Lead scorer
  ('new-hubspot-leads-read', 'Every lead created in HubSpot since the last run is read'),
  ('company-size-lookup', 'Each lead''s company size comes from Clearbit, or is marked unknown'),
  ('recent-activity-score', 'Leads with activity in the last 14 days score higher than leads without'),
  ('score-from-0-to-100', 'Every lead gets one score from 0 to 100'),
  ('reason-for-each-score', 'Each score comes with a one-line reason a salesperson can read'),
  ('top-5-posted-to-sales', 'The five highest scores post to #sales each morning'),
  ('daily-schedule', 'Scoring runs once every weekday at 8:00'),
  -- Vendor tracker
  ('vendor-list', 'Every vendor is listed with its owner and contract value'),
  ('renewal-dates', 'Each vendor has a renewal date, or is flagged as missing one'),
  ('reminder-30-days-before-renewal', 'The vendor''s owner gets a reminder 30 days before each renewal');
alter table seed_checks enable row level security;

create or replace function apply_seed_checks(p_workspace uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update items i set proved_when = c.proved_when
  from seed_checks c, projects p
  where i.key = c.key and i.project_id = p.id and p.workspace_id = p_workspace
    and i.proved_when ilike 'done when % passes its check';
$$;
revoke execute on function apply_seed_checks(uuid) from public, anon, authenticated;

-- 0019's body, plus the checks.
create or replace function apply_seed_updates(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update audit_log set target = (select name from workspaces where id = p_workspace)
  where workspace_id = p_workspace and action = 'workspace.seeded' and target = 'Acme Ops';
  update policies set config = '{"allowed": ["claude", "gpt", "gemini", "openrouter"]}'
  where workspace_id = p_workspace and kind = 'models';
  delete from allow_rules where workspace_id = p_workspace;
  insert into projects (workspace_id, name, owner_id, status, current_version, model, prompt, icon, legacy_repo, updated_at)
  select p_workspace, 'Ticket triage (Architect 1.0)', m.user_id, 'live', 1, 'gemini',
         'Classify incoming Zendesk tickets by urgency and team, and draft a reply for simple ones.',
         'lines', 'netanyaj/ticket-triage', now() - interval '40 days'
  from members m
  where m.workspace_id = p_workspace and m.role = 'owner' and m.user_id is not null
    and not exists (select 1 from projects p where p.workspace_id = p_workspace and p.legacy_repo is not null)
  limit 1;
  perform seed_lead_scorer_egress(p_workspace);
  update workspaces set plan = 'enterprise' where id = p_workspace;
  perform apply_seed_checks(p_workspace);
end;
$$;
revoke execute on function apply_seed_updates(uuid) from public, anon, authenticated;

-- The demo workspaces that already exist.
select apply_seed_checks(id) from workspaces where kind = 'demo';
