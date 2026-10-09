-- M4 Import a repo (screen 10, B-1 to B-3). The GitHub App's installations a workspace may use, and each import's
-- analysis before (and after) it becomes a project. An installation is stored only after GitHub confirms, through
-- the person's own GitHub sign-in for the App, that they can use it; the id in the install redirect alone is not trusted.

create table github_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  installation_id bigint not null,
  account_login text not null,
  account_type text not null,                        -- 'User' or 'Organization'
  repository_selection text,                         -- 'selected' or 'all'
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, installation_id)
);
alter table github_installations enable row level security;
create policy github_installations_read on github_installations for select using (is_member(workspace_id));

-- An import belongs to a workspace from the start; project_id is set when "Write the plan" makes the project.
alter table repo_imports add column workspace_id uuid references workspaces(id) on delete cascade;
alter table repo_imports add column installation_id bigint;
alter table repo_imports add column commit_sha text;
alter table repo_imports add column created_by uuid references auth.users(id) on delete set null;
create policy repo_imports_workspace_read on repo_imports for select using (workspace_id is not null and is_member(workspace_id));
create index repo_imports_workspace on repo_imports (workspace_id, created_at desc);
