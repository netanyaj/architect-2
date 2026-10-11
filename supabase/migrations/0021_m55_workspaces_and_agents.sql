-- M5.5. Two workspaces per person, and how an imported agent runs.
--
-- 1. Every person gets two workspaces on first sign-in: "Acme Ops (Enterprise)", the seeded demo with governance on
--    (Enterprise plan), and "Personal", empty, with governance off (Free plan). `workspaces.kind` tells them apart,
--    so Reset demo data only ever touches the demo. Existing demos are renamed and each owner gets a Personal.
-- 2. An agent imported in CrewAI or LangGraph records how it runs: kept in its framework (native), converted to a
--    Lyzr Studio agent (studio), or wrapped as a tool (tool).

alter table workspaces add column kind text not null default 'demo' check (kind in ('demo', 'personal'));
alter table agents add column run_as text not null default 'native' check (run_as in ('native', 'studio', 'tool'));

create or replace function create_demo_workspace(p_user uuid, p_email text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_personal uuid;
begin
  -- Serialise per person: two first sign-ins at once make one pair, not two.
  perform pg_advisory_xact_lock(hashtext('create_demo_workspace:' || p_user::text));

  select w.id into v_workspace
  from members m join workspaces w on w.id = m.workspace_id
  where m.user_id = p_user and m.role = 'owner' and m.status = 'active' and w.kind = 'demo'
  order by m.created_at
  limit 1;

  if v_workspace is null then
    insert into workspaces (name, kind) values ('Acme Ops (Enterprise)', 'demo') returning id into v_workspace;
    insert into members (workspace_id, user_id, email, display_name, role, status, invite_token, accepted_at)
    values (v_workspace, p_user, p_email, p_name, 'owner', 'active', null, now());
    perform seed_demo_workspace(v_workspace, p_user);
    perform apply_seed_updates(v_workspace);
  end if;

  -- The Personal workspace: empty, governance off, Free.
  select w.id into v_personal
  from members m join workspaces w on w.id = m.workspace_id
  where m.user_id = p_user and m.role = 'owner' and m.status = 'active' and w.kind = 'personal'
  limit 1;
  if v_personal is null then
    insert into workspaces (name, kind, governance_enabled, plan) values ('Personal', 'personal', false, 'free') returning id into v_personal;
    insert into members (workspace_id, user_id, email, display_name, role, status, invite_token, accepted_at)
    values (v_personal, p_user, p_email, p_name, 'owner', 'active', null, now());
    insert into audit_log (workspace_id, actor, action, target, details)
    values (v_personal, 'system', 'workspace.created', 'Personal', '{"note": "Your own workspace, governance off"}');
  end if;

  -- The demo comes first: it's where a new person lands.
  return v_workspace;
end;
$$;
revoke execute on function create_demo_workspace(uuid, text, text) from public, anon, authenticated;

-- Reset demo data never touches a Personal workspace (0004's body, plus the guard).
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
  if exists (select 1 from workspaces where id = p_workspace and kind = 'personal') then
    raise exception 'Personal workspaces have no demo data to reset' using errcode = '42501';
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
  perform apply_seed_updates(p_workspace);

  insert into audit_log (workspace_id, actor, action, target, details)
  values (p_workspace, p_owner::text, 'workspace.reset', v_name, '{"note": "Demo data reset from Settings"}');
end;
$$;
revoke execute on function reset_demo_workspace(uuid, uuid) from public, anon, authenticated;

-- Existing people: their seeded demo is renamed, and each owner of one gets a Personal workspace.
update workspaces w set name = 'Acme Ops (Enterprise)'
where exists (select 1 from audit_log a where a.workspace_id = w.id and a.action = 'workspace.seeded');

do $$
declare
  r record;
  v_personal uuid;
begin
  for r in
    select distinct on (m.user_id) m.user_id, m.email, m.display_name
    from members m join workspaces w on w.id = m.workspace_id
    where m.role = 'owner' and m.status = 'active' and m.user_id is not null and w.kind = 'demo'
      and not exists (
        select 1 from members m2 join workspaces w2 on w2.id = m2.workspace_id
        where m2.user_id = m.user_id and m2.role = 'owner' and w2.kind = 'personal'
      )
    order by m.user_id, m.created_at
  loop
    insert into workspaces (name, kind, governance_enabled, plan) values ('Personal', 'personal', false, 'free') returning id into v_personal;
    insert into members (workspace_id, user_id, email, display_name, role, status, invite_token, accepted_at)
    values (v_personal, r.user_id, r.email, r.display_name, 'owner', 'active', null, now());
    insert into audit_log (workspace_id, actor, action, target, details)
    values (v_personal, 'system', 'workspace.created', 'Personal', '{"note": "Your own workspace, governance off"}');
  end loop;
end;
$$;
