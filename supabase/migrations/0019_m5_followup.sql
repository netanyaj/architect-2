-- M5 follow-up (gap analysis, 11 Oct). Additive.
-- BL-9: an "API key" connection type. Simulated: only Set / Not set, by whom and when; the value is never stored.
-- C-10: a permission rule for external calls that use a key, so approvals and allow-rules can name it.
-- Plans: Free / Starter / Pro / Enterprise per workspace (Simulated billing), for the "Built with Architect" badge.
-- The seeded Acme Ops demo is on Enterprise (Netanya, 11 Oct); any other workspace starts on Free.
-- Seeds: Lead scorer reads HubSpot (approved for that project by Jordan) and is held on data egress (api.hubapi.com
-- isn't an allowed host); a Clearbit API key, set by Jordan, feeds its Company size lookup.

alter table connections
  add column kind text not null default 'oauth' check (kind in ('oauth', 'api_key')),
  add column set_by_name text,                      -- API keys: who set it
  add column set_at timestamptz;                    -- API keys: when

alter table workspaces add column plan text not null default 'free' check (plan in ('free', 'starter', 'pro', 'enterprise'));

alter table allow_rules drop constraint allow_rules_action_check;
alter table allow_rules add constraint allow_rules_action_check check (action in ('connector', 'production_deploy', 'push_to_main', 'external_call'));
alter table approvals drop constraint approvals_kind_check;
alter table approvals add constraint approvals_kind_check check (kind in ('connector', 'deploy', 'token', 'budget', 'push', 'secret', 'external_call'));

-- The Lead scorer seed, for one workspace. Safe to run twice.
create or replace function seed_lead_scorer_egress(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  select id into v_project from projects where workspace_id = p_workspace and name = 'Lead scorer' limit 1;
  if v_project is null then return; end if;
  update items set provider = 'hubspot' where project_id = v_project and key = 'new-hubspot-leads-read' and provider is null;
  update items set provider = 'clearbit' where project_id = v_project and key = 'company-size-lookup' and provider is null;
  update items set provider = 'slack' where project_id = v_project and key = 'top-5-posted-to-sales' and provider is null;
  insert into allow_rules (workspace_id, action, project_id, target, reason, created_by_name, created_at)
  select p_workspace, 'connector', v_project, 'hubspot', 'Sales needs lead data for scoring.', 'Jordan (IT)', now() - interval '3 days'
  where not exists (select 1 from allow_rules where workspace_id = p_workspace and project_id = v_project and target = 'hubspot' and removed_at is null);
  insert into connections (workspace_id, provider, status, kind, set_by_name, set_at)
  select p_workspace, 'clearbit', 'connected', 'api_key', 'Jordan (IT)', now() - interval '3 days'
  where not exists (select 1 from connections where workspace_id = p_workspace and provider = 'clearbit');
end;
$$;
revoke execute on function seed_lead_scorer_egress(uuid) from public, anon, authenticated;

-- 0018's body, plus the Lead scorer seed.
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
end;
$$;
revoke execute on function apply_seed_updates(uuid) from public, anon, authenticated;

-- Workspaces made before this migration get the same Lead scorer seed, and the seeded demos move to Enterprise.
select seed_lead_scorer_egress(id) from workspaces;
update workspaces w set plan = 'enterprise'
where exists (select 1 from audit_log a where a.workspace_id = w.id and a.action = 'workspace.seeded');
