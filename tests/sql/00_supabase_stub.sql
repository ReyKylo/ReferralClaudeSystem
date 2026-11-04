-- Minimal stand-in for the parts of Supabase the migrations touch, so they can run on a plain Postgres 16
-- (locally and in CI). Never run this against the real project.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin; end if;
end $$;
grant anon, authenticated to authenticator;

create schema if not exists extensions;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);
-- Tests "log in" with: set local role authenticated; set local request.jwt.claim.sub = '<uuid>';
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

-- Vault: plain table, good enough to exercise the ERP migration.
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), secret text, name text, description text);
create or replace view vault.decrypted_secrets as select id, secret as decrypted_secret, name from vault.secrets;
create or replace function vault.create_secret(s text, n text default null, d text default null) returns uuid language sql
as $$ insert into vault.secrets (secret, name, description) values (s, n, d) returning id $$;
create or replace function vault.update_secret(i uuid, s text) returns void language sql
as $$ update vault.secrets set secret = s where id = i $$;
