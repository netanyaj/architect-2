-- M5.5 review: Recently deleted. Deleting a project moves it to "Recently deleted" for 30 days (Restore puts it
-- back); after that, or when an Owner deletes it permanently, the row and everything under it goes (cascade).
-- While deleted, people can't read it: the projects read policy hides it, and every table read through a project
-- (blueprints, items, runs, files…) is hidden with it, since their policies look the project up under the same rules.

alter table projects
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users(id) on delete set null,
  add column deleted_by_name text;

create index projects_deleted on projects (workspace_id, deleted_at) where deleted_at is not null;

drop policy projects_read on projects;
create policy projects_read on projects for select using (is_member(workspace_id) and deleted_at is null);

-- Tables that carry a project but are read by workspace: hide a deleted project's rows too. (Tables read through a
-- project already are: their policies look the project up under the policy above.) The usage ledger and the audit log
-- stay visible on purpose: they're history, and credits spent stay spent.
create or replace function project_not_deleted(p_project uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_project is null or exists (select 1 from projects where id = p_project and deleted_at is null);
$$;

drop policy agents_read on agents;
create policy agents_read on agents for select using (is_member(workspace_id) and project_not_deleted(project_id));
drop policy agent_runs_read on agent_runs;
create policy agent_runs_read on agent_runs for select using (exists (select 1 from agents a where a.id = agent_runs.agent_id and is_member(a.workspace_id) and project_not_deleted(a.project_id)));
drop policy approvals_read on approvals;
create policy approvals_read on approvals for select using (is_member(workspace_id) and project_not_deleted(project_id));
drop policy allow_rules_read on allow_rules;
create policy allow_rules_read on allow_rules for select using (is_member(workspace_id) and project_not_deleted(project_id));
drop policy repo_imports_workspace_read on repo_imports;
create policy repo_imports_workspace_read on repo_imports for select using (workspace_id is not null and is_member(workspace_id) and project_not_deleted(project_id));

-- Recently deleted, for the signed-in person: the projects they deleted, or all of the workspace's for its Owners and
-- Admins. Rows older than 30 days aren't listed (they're about to be purged).
create or replace function list_deleted_projects(p_workspace uuid)
returns table (id uuid, name text, deleted_at timestamptz, deleted_by uuid, deleted_by_name text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.deleted_at, p.deleted_by, p.deleted_by_name, p.status
  from projects p
  where p.workspace_id = p_workspace
    and p.deleted_at is not null
    and p.deleted_at > now() - interval '30 days'
    and exists (
      select 1 from members m
      where m.workspace_id = p_workspace and m.user_id = auth.uid() and m.status = 'active'
        and (m.role in ('owner', 'admin') or p.deleted_by = auth.uid())
    )
  order by p.deleted_at desc;
$$;
revoke execute on function list_deleted_projects(uuid) from public, anon;
grant execute on function list_deleted_projects(uuid) to authenticated;

-- Restore, by the person who deleted it or an Owner or Admin, within 30 days. RLS hides the row from normal updates.
create or replace function restore_project(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project projects%rowtype;
begin
  select * into v_project from projects where id = p_project;
  if v_project.id is null or v_project.deleted_at is null or v_project.deleted_at <= now() - interval '30 days' then
    raise exception 'That project can''t be restored any more' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from members m
    where m.workspace_id = v_project.workspace_id and m.user_id = auth.uid() and m.status = 'active'
      and (m.role in ('owner', 'admin') or v_project.deleted_by = auth.uid())
  ) then
    raise exception 'Only the person who deleted it, or an Owner or Admin, can restore it' using errcode = '42501';
  end if;
  update projects set deleted_at = null, deleted_by = null, deleted_by_name = null where id = p_project;
  return v_project.workspace_id;
end;
$$;
revoke execute on function restore_project(uuid) from public, anon;
grant execute on function restore_project(uuid) to authenticated;

-- Permanent delete, now: the workspace's Owner only, and only from Recently deleted.
create or replace function delete_project_forever(p_project uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
begin
  select workspace_id into v_workspace from projects where id = p_project and deleted_at is not null;
  if v_workspace is null then
    raise exception 'Only a project in Recently deleted can be deleted permanently' using errcode = 'P0002';
  end if;
  if not exists (select 1 from members m where m.workspace_id = v_workspace and m.user_id = auth.uid() and m.status = 'active' and m.role = 'owner') then
    raise exception 'Only the workspace Owner can delete a project permanently' using errcode = '42501';
  end if;
  update support_tickets set project_id = null where project_id = p_project;
  delete from projects where id = p_project;
  return v_workspace;
end;
$$;
revoke execute on function delete_project_forever(uuid) from public, anon;
grant execute on function delete_project_forever(uuid) to authenticated;

-- The purge: projects deleted more than 30 days ago go for good (a daily cron, and whenever Recently deleted opens).
-- Returns what it removed, so the server can delete their stored files too. Service role only.
create or replace function purge_deleted_projects(p_workspace uuid default null)
returns table (id uuid, workspace_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  update support_tickets set project_id = null
  where project_id in (select p.id from projects p where p.deleted_at <= now() - interval '30 days' and (p_workspace is null or p.workspace_id = p_workspace));
  return query
  delete from projects p
  where p.deleted_at <= now() - interval '30 days' and (p_workspace is null or p.workspace_id = p_workspace)
  returning p.id, p.workspace_id;
end;
$$;
revoke execute on function purge_deleted_projects(uuid) from public, anon, authenticated;
