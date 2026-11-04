-- The few ERP objects the `ref` schema relies on, for running the tests without the ERP repository (which is private).
-- When ERP_DIR is set, tests/sql/run.sh uses the real ERP migrations instead and skips this file.
create schema if not exists erp;
create type erp.user_role as enum ('owner', 'admin', 'staff');
create or replace function erp.today() returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Asia/Jakarta')::date $$;
create or replace function erp.normalize_wa(raw text) returns text language sql immutable set search_path = ''
as $$
  select case when d = '' then null when d like '0%' then '62' || substr(d, 2) when d like '8%' then '62' || d else d end
  from (select regexp_replace(coalesce(raw, ''), '\D', '', 'g') as d) s
$$;
create table erp.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role erp.user_role not null default 'staff',
  locale text not null default 'id'
);
create table erp.accounts (id uuid primary key default gen_random_uuid(), email text);
alter table erp.accounts enable row level security;
create policy members_read on erp.accounts for select to authenticated
  using (exists (select 1 from erp.profiles where user_id = auth.uid()));
grant usage on schema erp to authenticated;
grant select on all tables in schema erp to authenticated;
grant execute on all functions in schema erp to authenticated;
