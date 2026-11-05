-- Template: give a referral their own login for the Referral Portal.
-- 1. Supabase dashboard → Authentication → Users → "Invite user" (or "Add user") with the referral's email.
-- 2. Run this in the SQL Editor (it runs as postgres, so it calls the same steps as ref.create_referrer without the
--    admin check). Replace the three values.
-- Never give a referral a row in erp.profiles: that would let them into the ERP.
do $$
declare v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower('GANTI_EMAIL@contoh.com');
  if v_user is null then raise exception 'Login belum dibuat di Authentication → Users'; end if;
  if exists (select 1 from erp.profiles where user_id = v_user) then raise exception 'Login ini milik tim ERP'; end if;
  insert into ref.referrers (user_id, name, wa) values (v_user, 'GANTI_NAMA', 'GANTI_NOMOR_WA');
end $$;
