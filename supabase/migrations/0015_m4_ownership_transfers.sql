-- M4 Hand-off (F8): a project's owner (or an Owner or Admin) offers it to another member, with an optional note.
-- The offer stays pending until that member accepts: in the project if they have an account, or by accepting
-- their invite link if they were only invited (the existing invite flow). Accepted transfers are the project's
-- ownership history. The new owner sees a "You now own …" banner until they dismiss it (seen_at).

create table ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  from_user uuid references auth.users(id) on delete set null,
  from_name text not null,
  to_member uuid references members(id) on delete set null,
  to_user uuid references auth.users(id) on delete set null,
  to_name text not null,
  note text check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  seen_at timestamptz
);
alter table ownership_transfers enable row level security;
create policy ownership_transfers_read on ownership_transfers for select using (exists (select 1 from projects p where p.id = ownership_transfers.project_id and is_member(p.workspace_id)));
-- One open offer per project.
create unique index ownership_transfers_one_pending on ownership_transfers (project_id) where status = 'pending';
create index ownership_transfers_to_member on ownership_transfers (to_member) where status = 'pending';
