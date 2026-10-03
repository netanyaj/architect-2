-- Architect 2.0 prototype · M1: people, invites, credits, and the demo workspace seed.
-- Adds only what 0001 is missing for M1. Writes still go through server actions (service role).

-- People ---------------------------------------------------------------------
alter table members
  add column display_name text,
  add column email text,
  add column invite_token uuid unique default gen_random_uuid(),  -- the invite link; cleared when accepted
  add column invited_by uuid references auth.users(id),
  add column accepted_at timestamptz;

-- Active members don't need a token.
update members set invite_token = null where status = 'active';

-- Credits ----------------------------------------------------------------------
alter table workspaces
  add column credits_total numeric not null default 2000,
  add column credits_reset_on date not null default (date_trunc('month', now()) + interval '1 month')::date;

-- Projects: the prompt that started it, and its tile icon ---------------------------------
alter table projects
  add column prompt text,
  add column icon text not null default 'projects',
  -- Who lists and approvals show as the owner when it isn't the real owner_id yet
  -- (seeded projects for teammates without accounts). The F8 hand-off makes it real and clears it.
  add column owner_display_name text;

-- Support tickets need a workspace for staff routing; the asker can always read their own.
alter table support_tickets add column workspace_id uuid references workspaces(id) on delete set null;

-- Demo workspace seed --------------------------------------------------------------
-- Called once by the server when a person signs in for the first time with no workspace and no invite.
-- Fills their new workspace with the "Acme Ops" demo (docs/DATA-MODEL.md, Seed data).
create or replace function seed_demo_workspace(p_workspace uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
  v_blueprint uuid;
  v_run uuid;
  v_item record;
  v_check uuid;
  v_titles text[];
  v_groups text[];
  v_checks text[];
  i int;
begin
  update workspaces set governance_enabled = true where id = p_workspace;

  -- Teammates without accounts yet: invited, so they show in Settings.
  insert into members (workspace_id, invited_email, display_name, email, role, status, invited_by) values
    (p_workspace, 'sam@acme-ops.example', 'Sam', 'sam@acme-ops.example', 'builder', 'invited', p_owner),
    (p_workspace, 'jordan@acme-ops.example', 'Jordan (IT)', 'jordan@acme-ops.example', 'admin', 'invited', p_owner);

  -- Connections: Calendar and Slack connected, Gmail missing, HubSpot not allowed by policy.
  insert into connections (workspace_id, provider, status, scopes) values
    (p_workspace, 'google_calendar', 'connected', '{calendar.readonly}'),
    (p_workspace, 'slack', 'connected', '{chat:write}'),
    (p_workspace, 'gmail', 'missing', '{}'),
    (p_workspace, 'hubspot', 'missing', '{}');

  -- Policies.
  insert into policies (workspace_id, kind, config) values
    (p_workspace, 'location', '{"mode": "lyzr_cloud", "label": "Lyzr Cloud"}'),
    (p_workspace, 'models', '{"allowed": ["claude", "gpt", "gemini"]}'),
    (p_workspace, 'connectors', '{"allow": ["google_calendar", "gmail", "slack", "zendesk", "github"], "deny": ["hubspot"]}'),
    (p_workspace, 'egress', '{"mode": "allow_list", "hosts": ["slack.com", "googleapis.com", "zendesk.com"]}'),
    (p_workspace, 'permission', '{"needs_approval": ["push_to_main", "production_deploy"]}');

  ------------------------------------------------------------------ Meeting Prep: live, 12 of 12
  v_titles := array['Calendar events read','Last email thread per attendee','Agenda PDF summarised','Talking points','Brief before each meeting',
                    'Slack delivery','Brief writer','Research agent (yours)','Meeting list','Brief page','Sign-in','Error alerts'];
  v_groups := array['integrations','integrations','agents','agents','features','integrations','agents','agents','features','features','data','quality'];
  insert into projects (workspace_id, name, owner_id, status, current_version, budget_credits, model, prompt, icon, updated_at)
  values (p_workspace, 'Meeting Prep', p_owner, 'live', 1, 250, 'claude-sonnet',
          'Before each meeting on my calendar, send me a Slack brief with each attendee''s last email thread, a summary of any attached agenda PDF, and three talking points.',
          'calendar', now() - interval '2 hours')
  returning id into v_project;
  insert into blueprints (project_id, version, status, prompt, summary, total_likely, est_minutes, created_by, agreed_at)
  values (v_project, 1, 'agreed', (select prompt from projects where id = v_project), 'A Slack brief before every meeting', 160, 14, p_owner, now() - interval '3 days')
  returning id into v_blueprint;
  for i in 1 .. array_length(v_titles, 1) loop
    insert into items (blueprint_id, project_id, key, grp, title, proved_when, status, estimate_likely, cost_actual, position)
    values (v_blueprint, v_project, lower(regexp_replace(v_titles[i], '[^a-zA-Z0-9]+', '-', 'g')), v_groups[i], v_titles[i],
            'Done when ' || lower(v_titles[i]) || ' passes its check', 'built', 13, 14, i);
  end loop;
  insert into runs (project_id, blueprint_id, kind, status, started_by, started_at, finished_at)
  values (v_project, v_blueprint, 'build', 'done', p_owner, now() - interval '3 days', now() - interval '3 days' + interval '14 minutes')
  returning id into v_run;
  insert into environments (project_id, name, url, status) values
    (v_project, 'preview', 'meeting-prep--test.architect.space', 'live'),
    (v_project, 'staging', 'meeting-prep--team.architect.space', 'live'),
    (v_project, 'production', 'meeting-prep.architect.space', 'live');
  insert into usage_ledger (workspace_id, project_id, run_id, kind, credits, note, created_at) values
    (p_workspace, v_project, null, 'blueprint', 4, 'Plan written', now() - interval '3 days'),
    (p_workspace, v_project, v_run, 'build', 162, 'Build · 12 parts', now() - interval '3 days'),
    (p_workspace, v_project, v_run, 'fix', 3, 'Fix · Brief writer, try 1 of 3', now() - interval '3 days'),
    (p_workspace, v_project, null, 'running', 3, 'Running · 41 briefs sent', now() - interval '2 hours');

  ------------------------------------------------------------------ ticket-triage: 5 of 6, waiting for approval
  v_titles := array['New tickets read','Urgency and team label','Draft reply for simple tickets','VIP escalation','Slack alert to the team','Production deploy'];
  v_groups := array['integrations','agents','agents','features','integrations','quality'];
  insert into projects (workspace_id, name, owner_id, owner_display_name, status, current_version, budget_credits, model, prompt, icon, updated_at)
  values (p_workspace, 'ticket-triage', p_owner, 'Sam', 'built', 1, 150, 'claude-sonnet',
          'Classify incoming Zendesk tickets by urgency and team, draft a reply for simple ones, and escalate anything from VIP customers.',
          'lines', now() - interval '1 day')
  returning id into v_project;
  insert into blueprints (project_id, version, status, prompt, summary, total_likely, est_minutes, created_by, agreed_at)
  values (v_project, 1, 'agreed', (select prompt from projects where id = v_project), 'Zendesk tickets sorted and answered', 96, 9, p_owner, now() - interval '1 day')
  returning id into v_blueprint;
  for i in 1 .. array_length(v_titles, 1) loop
    insert into items (blueprint_id, project_id, key, grp, title, proved_when, status, status_detail, estimate_likely, cost_actual, position)
    values (v_blueprint, v_project, lower(regexp_replace(v_titles[i], '[^a-zA-Z0-9]+', '-', 'g')), v_groups[i], v_titles[i],
            'Done when ' || lower(v_titles[i]) || ' passes its check',
            case when i = 6 then 'needs_approval' else 'built' end,
            case when i = 6 then 'IT admin reviews' end, 16, case when i = 6 then 0 else 18 end, i);
  end loop;
  insert into runs (project_id, blueprint_id, kind, status, started_by, started_at, finished_at)
  values (v_project, v_blueprint, 'build', 'done', p_owner, now() - interval '1 day', now() - interval '1 day' + interval '9 minutes')
  returning id into v_run;
  insert into usage_ledger (workspace_id, project_id, run_id, kind, credits, note, created_at) values
    (p_workspace, v_project, null, 'blueprint', 3, 'Plan written', now() - interval '1 day'),
    (p_workspace, v_project, v_run, 'build', 93, 'Build · 5 parts', now() - interval '1 day');
  insert into approvals (workspace_id, project_id, kind, title, requested_by, payload) values
    (p_workspace, v_project, 'deploy', 'ticket-triage: Production deploy', p_owner, '{"environment": "production", "requested_by_name": "Sam"}');

  ------------------------------------------------------------------ Lead scorer: paused at budget, 4 of 7
  v_titles := array['New HubSpot leads read','Company size lookup','Recent activity score','Score from 0 to 100','Reason for each score','Top 5 posted to #sales','Daily schedule'];
  v_groups := array['integrations','data','agents','agents','agents','integrations','features'];
  insert into projects (workspace_id, name, owner_id, status, current_version, budget_credits, model, prompt, icon, updated_at)
  values (p_workspace, 'Lead scorer', p_owner, 'paused', 1, 100, 'gemini',
          'Every morning, score new HubSpot leads from 0 to 100 using company size and recent activity, explain each score, and post the top 5 to #sales.',
          'usage', now() - interval '4 days')
  returning id into v_project;
  insert into blueprints (project_id, version, status, prompt, summary, total_likely, est_minutes, created_by, agreed_at)
  values (v_project, 1, 'agreed', (select prompt from projects where id = v_project), 'Morning lead scores in #sales', 125, 12, p_owner, now() - interval '4 days')
  returning id into v_blueprint;
  for i in 1 .. array_length(v_titles, 1) loop
    insert into items (blueprint_id, project_id, key, grp, title, proved_when, status, estimate_likely, cost_actual, position)
    values (v_blueprint, v_project, lower(regexp_replace(v_titles[i], '[^a-zA-Z0-9]+', '-', 'g')), v_groups[i], v_titles[i],
            'Done when ' || lower(v_titles[i]) || ' passes its check',
            case when i <= 4 then 'built' else 'agreed' end, 18, case when i <= 4 then 24 else 0 end, i);
  end loop;
  insert into runs (project_id, blueprint_id, kind, status, started_by, started_at)
  values (v_project, v_blueprint, 'build', 'paused_budget', p_owner, now() - interval '4 days')
  returning id into v_run;
  insert into usage_ledger (workspace_id, project_id, run_id, kind, credits, note, created_at) values
    (p_workspace, v_project, v_run, 'build', 96, 'Build · 4 parts', now() - interval '4 days'),
    (p_workspace, v_project, v_run, 'fix', 4, 'Fix · Recent activity score, try 1 of 3', now() - interval '4 days');

  ------------------------------------------------------------------ Vendor tracker: plan ready, not built
  v_titles := array['Vendor list','Renewal dates','Reminder 30 days before renewal'];
  v_groups := array['data','features','integrations'];
  insert into projects (workspace_id, name, owner_id, status, current_version, budget_credits, model, prompt, icon, updated_at)
  values (p_workspace, 'Vendor tracker', p_owner, 'draft', 1, null, 'gemini',
          'Keep a list of our vendors with renewal dates and remind me in Slack 30 days before each renewal.',
          'doc', now() - interval '8 days')
  returning id into v_project;
  insert into blueprints (project_id, version, status, prompt, summary, total_likely, est_minutes, created_by)
  values (v_project, 1, 'draft', (select prompt from projects where id = v_project), 'Vendor renewals, never missed', 48, 6, p_owner)
  returning id into v_blueprint;
  for i in 1 .. array_length(v_titles, 1) loop
    insert into items (blueprint_id, project_id, key, grp, title, proved_when, status, estimate_likely, position)
    values (v_blueprint, v_project, lower(regexp_replace(v_titles[i], '[^a-zA-Z0-9]+', '-', 'g')), v_groups[i], v_titles[i],
            'Done when ' || lower(v_titles[i]) || ' passes its check', 'proposed', 16, i);
  end loop;
  insert into usage_ledger (workspace_id, project_id, kind, credits, note, created_at) values
    (p_workspace, v_project, 'blueprint', 4, 'Plan written', now() - interval '8 days');

  -- Built items need a passing proof (DATA-MODEL rule 5): one locked check and one pass per built item.
  for v_item in
    select it.id, it.grp from items it join projects p on p.id = it.project_id
    where p.workspace_id = p_workspace and it.status = 'built'
  loop
    insert into checks (item_id, kind, description, written_at)
    values (v_item.id,
            case v_item.grp when 'features' then 'ui_test' when 'agents' then 'eval' when 'quality' then 'http' else 'api_test' end,
            'Seeded check', now() - interval '5 days')
    returning id into v_check;
    insert into proofs (item_id, check_id, attempt, result, assertions_passed, assertions_total, summary)
    values (v_item.id, v_check, 0, 'pass', 3, 3, 'All assertions passed');
  end loop;

  -- Approvals waiting (besides the ticket-triage deploy above).
  insert into approvals (workspace_id, kind, title, requested_by, payload) values
    (p_workspace, 'connector', 'HubSpot connector', p_owner, '{"provider": "hubspot"}'),
    (p_workspace, 'token', 'Claude Code token for Sam', p_owner, '{"agent": "Claude Code", "for": "Sam", "requested_by_name": "Sam"}');

  insert into audit_log (workspace_id, actor, action, target, details) values
    (p_workspace, 'system', 'workspace.seeded', 'Acme Ops', '{"note": "Demo data for the prototype"}');
end;
$$;

revoke execute on function seed_demo_workspace(uuid, uuid) from public, anon, authenticated;

-- First sign-in ---------------------------------------------------------------------
-- Every person gets their own seeded "Acme Ops" on first sign-in, so each reviewer has a clean
-- workspace and nobody overwrites anyone else's. Accepting an invite later adds a second membership.
-- Idempotent: a person who already owns a workspace gets that one back (safe under concurrent loads).
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

  insert into workspaces (name) values ('Acme Ops') returning id into v_workspace;
  insert into members (workspace_id, user_id, email, display_name, role, status, invite_token, accepted_at)
  values (v_workspace, p_user, p_email, p_name, 'owner', 'active', null, now());
  perform seed_demo_workspace(v_workspace, p_user);
  return v_workspace;
end;
$$;

-- Reset demo data (Settings, Owner only) -----------------------------------------------
-- Removes the workspace's projects and demo records, then re-runs the seed.
-- Keeps: the workspace, real members and real invites, support tickets, and the audit log (it gets a reset row).
create or replace function reset_demo_workspace(p_workspace uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from members m
    where m.workspace_id = p_workspace and m.user_id = p_owner and m.role = 'owner' and m.status = 'active'
  ) then
    raise exception 'Only the workspace owner can reset demo data' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('reset_demo_workspace:' || p_workspace::text));

  -- Tickets point at projects without a cascade; keep the tickets, drop the link.
  update support_tickets set project_id = null
  where project_id in (select id from projects where workspace_id = p_workspace);

  delete from usage_ledger where workspace_id = p_workspace;
  delete from approvals where workspace_id = p_workspace;
  delete from agents where workspace_id = p_workspace;
  delete from projects where workspace_id = p_workspace;      -- cascades to plans, parts, runs, events, files…
  delete from connections where workspace_id = p_workspace;
  delete from policies where workspace_id = p_workspace;
  -- The seeded teammates (never-accepted invites to the demo addresses) are re-created by the seed.
  delete from members
  where workspace_id = p_workspace and user_id is null
    and lower(invited_email) in ('sam@acme-ops.example', 'jordan@acme-ops.example');

  perform seed_demo_workspace(p_workspace, p_owner);

  insert into audit_log (workspace_id, actor, action, target, details)
  values (p_workspace, p_owner::text, 'workspace.reset', 'Acme Ops', '{"note": "Demo data reset from Settings"}');
end;
$$;

revoke execute on function create_demo_workspace(uuid, text, text) from public, anon, authenticated;
revoke execute on function reset_demo_workspace(uuid, uuid) from public, anon, authenticated;
