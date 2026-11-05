-- Self sign-up for referrals: anyone can make a portal login with username + WhatsApp number + password,
-- no email and no verification step.
-- STATUS: applied to the Supabase project vfttmslrjimbndseqqko on 2026-11-05 (owner agreed).
--
-- How it works
--   Supabase Auth needs an email, so the portal turns the username into a login address that never receives mail:
--   <username>@<settings.login_email_domain>, e.g. gipong@referral.tampilresmi.com. With "Confirm email" switched off
--   in Supabase Auth, signUp() logs the person in straight away. The portal then calls ref.register_me(), which turns
--   that login into a referral (a row in ref.referrers). Because the login address comes from the username, Supabase
--   itself refuses a second account with the same username.
--
-- ERP safety: a self-made login has no row in erp.profiles, so the ERP's RLS shows it nothing (tested), and
-- ref.register_me() refuses ERP logins.

insert into ref.settings (key, value) values
  ('login_email_domain', '"referral.tampilresmi.com"'),
  -- owner's WhatsApp: forgot password, questions, and every withdrawal request (the referral sends rekening/VA there)
  ('admin_wa', '"6281299323591"'),
  -- promised payout time after the WhatsApp message, shown to referrals
  ('payout_hours', '24');

alter table ref.referrers add column username extensions.citext;
-- Who invited this referral ("Ajak teman"). Recorded only; no commission is attached to inviting.
alter table ref.referrers add column invited_by uuid references ref.referrers (id);
create index referrers_invited_by_idx on ref.referrers (invited_by) where invited_by is not null;
alter table ref.referrers add constraint referrers_username_format check (username is null or username ~ '^[a-z0-9_.]{3,20}$');
create unique index referrers_username_key on ref.referrers (username) where username is not null;

-- Lowercase, 3-20 characters: letters, digits, dot, underscore.
create or replace function ref.clean_username(p_username text)
returns text language sql immutable set search_path = ''
as $$ select lower(trim(coalesce(p_username, ''))) $$;

-- Sign-up form check before an account is made (callable before login). Says only whether each value is still free.
create or replace function ref.signup_available(p_username text, p_wa text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'username_valid', ref.clean_username(p_username) ~ '^[a-z0-9_.]{3,20}$',
    'username_free', not exists (select 1 from ref.referrers where username = ref.clean_username(p_username)::extensions.citext),
    'wa_valid', length(coalesce(erp.normalize_wa(p_wa), '')) between 10 and 15,
    'wa_free', not exists (select 1 from ref.referrers where wa_norm = erp.normalize_wa(p_wa))
  )
$$;

-- Log in with the username OR the WhatsApp number (people remember their number). Returns the login address to pass
-- to signInWithPassword(), or null when nothing matches. Callable before login; it reveals only the username behind a
-- number that already has an account, which the sign-up check reveals anyway.
create or replace function ref.login_email(p_identifier text)
returns text language sql stable security definer set search_path = ''
as $$
  -- self-made accounts: <username>@<domain>; accounts an admin made: the email they were invited with
  select coalesce(r.username || '@' || (select value #>> '{}' from ref.settings where key = 'login_email_domain'),
                  (select u.email from auth.users u where u.id = r.user_id))
  from ref.referrers r
  where r.active and r.user_id is not null
    and (r.username = ref.clean_username(p_identifier)::extensions.citext
         or (length(coalesce(erp.normalize_wa(p_identifier), '')) >= 10 and r.wa_norm = erp.normalize_wa(p_identifier)))
  limit 1
$$;

-- Called once right after signUp(). Makes the logged-in user a referral. p_invite = the inviter's username from the
-- invite link (?ajak=gipong); unknown or own usernames are ignored rather than blocking the sign-up.
create or replace function ref.register_me(p_username text, p_wa text, p_invite text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid(); v_email text; v_name text := ref.clean_username(p_username); v_id uuid;
  v_domain text := (select value #>> '{}' from ref.settings where key = 'login_email_domain');
begin
  if v_user is null then raise exception 'Belum login' using errcode = '42501'; end if;
  if exists (select 1 from erp.profiles where user_id = v_user) then
    raise exception 'Login ini milik tim ERP, tidak bisa dijadikan referral' using errcode = '22023';
  end if;
  select id into v_id from ref.referrers where user_id = v_user;
  if found then return v_id; end if;   -- already registered (e.g. the page was reloaded)
  if v_name !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Username 3-20 karakter: huruf kecil, angka, titik, atau garis bawah' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = v_user;
  if lower(v_email) is distinct from v_name || '@' || v_domain then
    raise exception 'Username tidak cocok dengan login' using errcode = '22023';
  end if;
  if length(coalesce(erp.normalize_wa(p_wa), '')) not between 10 and 15 then
    raise exception 'Nomor WhatsApp belum benar' using errcode = '22023';
  end if;
  if exists (select 1 from ref.referrers where wa_norm = erp.normalize_wa(p_wa)) then
    raise exception 'Nomor WhatsApp ini sudah dipakai referral lain' using errcode = '23505';
  end if;
  insert into ref.referrers (user_id, name, username, wa, invited_by)
  values (v_user, v_name, v_name, trim(p_wa),
          (select r.id from ref.referrers r where r.active and r.username = ref.clean_username(p_invite)::extensions.citext and r.username <> v_name::extensions.citext))
  returning id into v_id;
  perform ref.audit('referrer.signup', 'referrer', v_id::text, jsonb_build_object('username', v_name, 'invite', p_invite));
  perform ref.notify_admins('new_referrer', jsonb_build_object('referrer_id', v_id, 'username', v_name,
          'invited_by', (select r.name from ref.referrers r join ref.referrers me on me.invited_by = r.id where me.id = v_id)));
  perform ref.notify_referrer((select invited_by from ref.referrers where id = v_id), 'friend_joined', jsonb_build_object('username', v_name));
  return v_id;
end $$;

-- A referral may change the display name later (username and login stay the same).
create or replace function ref.update_my_profile(p_name text, p_wa text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('referral');
  if coalesce(trim(p_name), '') = '' then raise exception 'Isi nama' using errcode = '22023'; end if;
  if length(coalesce(erp.normalize_wa(p_wa), '')) not between 10 and 15 then
    raise exception 'Nomor WhatsApp belum benar' using errcode = '22023';
  end if;
  if exists (select 1 from ref.referrers where wa_norm = erp.normalize_wa(p_wa) and id <> ref.my_referrer_id()) then
    raise exception 'Nomor WhatsApp ini sudah dipakai referral lain' using errcode = '23505';
  end if;
  update ref.referrers set name = trim(p_name), wa = trim(p_wa) where id = ref.my_referrer_id();
  perform ref.audit('referrer.profile', 'referrer', ref.my_referrer_id()::text);
end $$;

-- Admin can switch a referral off (they can still log in but see nothing and cannot submit).
create or replace function ref.set_referrer_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin');
  update ref.referrers set active = p_active where id = p_id;
  perform ref.audit(case when p_active then 'referrer.activate' else 'referrer.deactivate' end, 'referrer', p_id::text);
end $$;

revoke execute on function ref.clean_username(text), ref.signup_available(text, text), ref.login_email(text), ref.register_me(text, text, text),
  ref.update_my_profile(text, text), ref.set_referrer_active(uuid, boolean) from public;
grant execute on function ref.clean_username(text), ref.register_me(text, text, text), ref.update_my_profile(text, text),
  ref.set_referrer_active(uuid, boolean), ref.signup_available(text, text), ref.login_email(text) to authenticated;
-- The sign-up and log-in forms run before login: anon may call only these two. No table is readable by anon.
grant usage on schema ref to anon;
grant execute on function ref.signup_available(text, text), ref.login_email(text) to anon;
