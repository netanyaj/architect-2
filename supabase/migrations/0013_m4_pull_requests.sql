-- M4 Changes as PRs (B-4, BL-11), simulated: each build or applied change on a project imported from a repo opens a
-- branch and a pull request into main listing the parts it implements. Nothing reaches main until someone merges it,
-- and under governance a Builder's merge (a push to main) waits for an Owner or Admin.

create table pull_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  blueprint_id uuid references blueprints(id) on delete set null,
  number int not null,
  branch text not null,
  base text not null default 'main',
  title text not null,
  parts jsonb not null default '[]',                 -- [{key, title}]: the parts this PR implements
  status text not null default 'open' check (status in ('open', 'merged', 'closed')),
  merged_by uuid references auth.users(id) on delete set null,
  merged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);
alter table pull_requests enable row level security;
create policy pull_requests_read on pull_requests for select using (exists (select 1 from projects p where p.id = pull_requests.project_id and is_member(p.workspace_id)));
alter publication supabase_realtime add table pull_requests;

-- A Builder's push to main under governance is an approval request.
alter table approvals drop constraint approvals_kind_check;
alter table approvals add constraint approvals_kind_check check (kind in ('connector', 'deploy', 'token', 'budget', 'push'));
