-- M5 follow-up, a fix to 0019's seed. Lead scorer's Company size lookup calls Clearbit with an API key, but under
-- governance Clearbit wasn't an allowed app, so the part would wait for approval and api.clearbit.com would be held
-- on egress too. Jordan (IT) now allows Clearbit in every project (a rule in Approvals › Rules) and its host for
-- data, so Lead scorer's one egress hold is HubSpot's api.hubapi.com, as the demo intends.

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
  -- New in 0020: Clearbit allowed everywhere, and its host for data.
  insert into allow_rules (workspace_id, action, project_id, target, reason, created_by_name, created_at)
  select p_workspace, 'connector', null, 'clearbit', 'Company data for lead scoring. Read only.', 'Jordan (IT)', now() - interval '3 days'
  where not exists (select 1 from allow_rules where workspace_id = p_workspace and project_id is null and target = 'clearbit' and removed_at is null);
  update policies
  set config = jsonb_set(config, '{hosts}', coalesce(config -> 'hosts', '[]'::jsonb) || '["api.clearbit.com"]'::jsonb)
  where workspace_id = p_workspace and kind = 'egress' and jsonb_typeof(config -> 'hosts') = 'array' and not (config -> 'hosts' ? 'api.clearbit.com');
end;
$$;
revoke execute on function seed_lead_scorer_egress(uuid) from public, anon, authenticated;

-- Existing workspaces with Lead scorer get the rule and the host.
select seed_lead_scorer_egress(id) from workspaces;
