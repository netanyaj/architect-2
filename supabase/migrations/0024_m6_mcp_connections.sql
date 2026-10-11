-- M6: MCP servers in Connections (PRD BL-9: "OAuth, MCP, API keys").
--
-- A third kind of connection row: an MCP server, by name and HTTPS URL, with an optional auth header kept encrypted in
-- Supabase Vault (like the workspace's Lyzr key, 0023) and never returned to the browser. "Test connection" records
-- the server's tools, when it was checked, and why it failed if it did. Agents pick from these servers' tools.
-- Members can read the row (name, URL, tools, last check), as for every connection; only the server decrypts the header.

alter table connections drop constraint connections_kind_check;
alter table connections add constraint connections_kind_check check (kind in ('oauth', 'api_key', 'mcp'));

alter table connections
  add column name text,                    -- MCP: what people call it ("Acme docs")
  add column url text check (url is null or url ~ '^https://'),
  add column auth_secret_id uuid,          -- MCP: the auth header's Vault secret, if any
  add column tools jsonb,                  -- MCP: [{ "name": "...", "description": "..." }] from the last good test
  add column checked_at timestamptz,       -- MCP: the last test, good or not
  add column check_error text;             -- MCP: why the last test failed, in plain words

-- One row per server URL in a workspace.
create unique index connections_mcp_url on connections (workspace_id, url) where kind = 'mcp';

create or replace function set_connection_secret(p_connection uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old uuid;
begin
  select auth_secret_id into v_old from connections where id = p_connection;
  update connections set auth_secret_id = vault.create_secret(p_value, null, 'connection ' || p_connection::text) where id = p_connection;
  if v_old is not null then delete from vault.secrets where id = v_old; end if;
end;
$$;

create or replace function connection_secret(p_connection uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  return (
    select d.decrypted_secret
    from connections c join vault.decrypted_secrets d on d.id = c.auth_secret_id
    where c.id = p_connection
  );
end;
$$;

-- A removed server takes its auth header with it.
create or replace function drop_connection_secret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.auth_secret_id is not null then delete from vault.secrets where id = old.auth_secret_id; end if;
  return old;
end;
$$;
create trigger connections_drop_vault after delete on connections for each row execute function drop_connection_secret();

revoke execute on function set_connection_secret(uuid, text) from public, anon, authenticated;
revoke execute on function connection_secret(uuid) from public, anon, authenticated;
revoke execute on function drop_connection_secret() from public, anon, authenticated;
