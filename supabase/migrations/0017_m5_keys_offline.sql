-- M5 Keys and passwords, Take offline, and a filterable audit log (C-6, C-10), simulated.
-- A key is recorded per version as Set (or waiting for an admin), with who set it and when. Its value is never stored:
-- the server checks it was typed and throws it away. Under governance a Builder's key for Live waits for approval.

create table project_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (name ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  environment text not null check (environment in ('preview', 'staging', 'production')),
  status text not null default 'set' check (status in ('set', 'waiting')),
  set_by uuid references auth.users(id) on delete set null,
  set_by_name text not null,
  set_at timestamptz not null default now(),
  approval_id uuid references approvals(id) on delete set null,
  unique (project_id, name, environment)
);
alter table project_keys enable row level security;
create policy project_keys_read on project_keys for select using (exists (select 1 from projects p where p.id = project_keys.project_id and is_member(p.workspace_id)));

-- A Builder setting a Live key under governance is an approval request.
alter table approvals drop constraint approvals_kind_check;
alter table approvals add constraint approvals_kind_check check (kind in ('connector', 'deploy', 'token', 'budget', 'push', 'secret'));

-- Take offline: the Live version stops serving but is kept, so going live again brings it back.
alter table deployments drop constraint deployments_status_check;
alter table deployments add constraint deployments_status_check
  check (status in ('checking', 'blocked', 'deploying', 'live', 'rolled_back', 'failed', 'offline'));

-- The audit log is read newest first per workspace, with filters.
create index if not exists audit_log_workspace_time on audit_log (workspace_id, created_at desc);
