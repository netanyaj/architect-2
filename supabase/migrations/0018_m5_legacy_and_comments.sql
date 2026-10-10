-- M5 task 5. F9: an Architect 1.0 app keeps running unchanged until someone moves it to 2.0, which imports it from
-- its repo as a plan; the old app then points at the new project. BL-15: anyone in the workspace, Viewers included,
-- can comment on a plan part.

alter table projects add column legacy_repo text;                                    -- an Architect 1.0 app: its repo
alter table projects add column moved_to uuid references projects(id) on delete set null;  -- the 2.0 project it became

create table part_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  item_key text not null,                          -- the part, across plan versions
  body text not null check (char_length(body) between 1 and 1000),
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now()
);
create index part_comments_project on part_comments (project_id, created_at);
alter table part_comments enable row level security;
create policy part_comments_read on part_comments for select using (exists (select 1 from projects p where p.id = part_comments.project_id and is_member(p.workspace_id)));

-- The seeded Architect 1.0 app, for every new or reset demo workspace (0016's body, plus the insert).
create or replace function apply_seed_updates(p_workspace uuid)
returns void
language sql
security definer
set search_path = public
as $$
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
$$;
revoke execute on function apply_seed_updates(uuid) from public, anon, authenticated;

-- Workspaces made before this migration get the same app, and nothing else in them changes.
insert into projects (workspace_id, name, owner_id, status, current_version, model, prompt, icon, legacy_repo, updated_at)
select distinct on (m.workspace_id) m.workspace_id, 'Ticket triage (Architect 1.0)', m.user_id, 'live', 1, 'gemini',
       'Classify incoming Zendesk tickets by urgency and team, and draft a reply for simple ones.',
       'lines', 'netanyaj/ticket-triage', now() - interval '40 days'
from members m
where m.role = 'owner' and m.user_id is not null
  and not exists (select 1 from projects p where p.workspace_id = m.workspace_id and p.legacy_repo is not null)
order by m.workspace_id, m.created_at;
