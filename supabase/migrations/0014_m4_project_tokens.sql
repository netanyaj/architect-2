-- M4 Bring your own coding agent (F4, B-7), simulated: a project token a coding agent (Claude Code, Cursor) would use
-- with Architect's MCP server. Scoped and revocable. Only a hash and the last 4 characters are stored; the token is
-- shown once, when it's made. No server accepts it in this prototype. With governance on, a token waits for approval.

create table project_tokens (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  scopes text[] not null,
  token_hash text not null unique,
  last4 text not null,
  status text not null default 'active' check (status in ('waiting', 'active', 'revoked')),
  approval_id uuid references approvals(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table project_tokens enable row level security;
create policy project_tokens_read on project_tokens for select using (exists (select 1 from projects p where p.id = project_tokens.project_id and is_member(p.workspace_id)));
create index project_tokens_project on project_tokens (project_id, created_at desc);
