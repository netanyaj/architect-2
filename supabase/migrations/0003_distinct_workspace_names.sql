-- Architect 2.0 prototype · Distinct workspace names.
-- Every person gets their own demo workspace; name it after them ("Netanya's Acme Ops") so the
-- workspaces table, the switcher and invites can tell them apart.

-- "Netanya Jaison" → "Netanya's Acme Ops"; no name → the start of the email ("jane@x.com" → "Jane's Acme Ops").
create or replace function workspace_name_for(p_name text, p_email text)
returns text
language plpgsql
immutable
as $$
declare
  v_first text := split_part(trim(coalesce(p_name, '')), ' ', 1);
begin
  if v_first = '' then
    v_first := split_part(split_part(coalesce(p_email, ''), '@', 1), '.', 1);
  end if;
  if v_first = '' then
    return 'Acme Ops';
  end if;
  return initcap(v_first) || '''s Acme Ops';
end;
$$;

-- First sign-in now names the workspace after its owner. Otherwise unchanged from 0002.
create or replace function create_demo_workspace(p_user uuid, p_email text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_name text := workspace_name_for(p_name, p_email);
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

  insert into workspaces (name) values (v_name) returning id into v_workspace;
  insert into members (workspace_id, user_id, email, display_name, role, status, invite_token, accepted_at)
  values (v_workspace, p_user, p_email, p_name, 'owner', 'active', null, now());
  perform seed_demo_workspace(v_workspace, p_user);
  update audit_log set target = v_name where workspace_id = v_workspace and action = 'workspace.seeded';
  return v_workspace;
end;
$$;

-- Reset logs the workspace's own name. Otherwise unchanged from 0002.
create or replace function reset_demo_workspace(p_workspace uuid, p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if not exists (
    select 1 from members m
    where m.workspace_id = p_workspace and m.user_id = p_owner and m.role = 'owner' and m.status = 'active'
  ) then
    raise exception 'Only the workspace owner can reset demo data' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('reset_demo_workspace:' || p_workspace::text));
  select name into v_name from workspaces where id = p_workspace;

  update support_tickets set project_id = null
  where project_id in (select id from projects where workspace_id = p_workspace);

  delete from usage_ledger where workspace_id = p_workspace;
  delete from approvals where workspace_id = p_workspace;
  delete from agents where workspace_id = p_workspace;
  delete from projects where workspace_id = p_workspace;
  delete from connections where workspace_id = p_workspace;
  delete from policies where workspace_id = p_workspace;
  delete from members
  where workspace_id = p_workspace and user_id is null
    and lower(invited_email) in ('sam@acme-ops.example', 'jordan@acme-ops.example');

  perform seed_demo_workspace(p_workspace, p_owner);
  -- The seed's own log line uses the generic name; give it this workspace's name.
  update audit_log set target = v_name
  where workspace_id = p_workspace and action = 'workspace.seeded' and target = 'Acme Ops';

  insert into audit_log (workspace_id, actor, action, target, details)
  values (p_workspace, p_owner::text, 'workspace.reset', v_name, '{"note": "Demo data reset from Settings"}');
end;
$$;

revoke execute on function create_demo_workspace(uuid, text, text) from public, anon, authenticated;
revoke execute on function reset_demo_workspace(uuid, uuid) from public, anon, authenticated;

-- Rename the workspaces that already exist, after their owners. Only the generic name is replaced.
update workspaces w
set name = workspace_name_for(m.display_name, m.email)
from members m
where m.workspace_id = w.id and m.role = 'owner' and m.status = 'active' and w.name = 'Acme Ops';

update audit_log a
set target = w.name
from workspaces w
where a.workspace_id = w.id and a.action = 'workspace.seeded' and a.target = 'Acme Ops';
