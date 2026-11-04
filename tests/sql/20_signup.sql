-- Self sign-up: username + WhatsApp + password, no email verification.
\set ON_ERROR_STOP 1
\set QUIET 1
-- Supabase signUp() with "Confirm email" off creates the auth user; here we create it directly.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'budi_ref@referral.tampilresmi.com'),
  ('00000000-0000-0000-0000-0000000000e2', 'sari.ref@referral.tampilresmi.com'),
  ('00000000-0000-0000-0000-0000000000e3', 'kosong@referral.tampilresmi.com');

-- before login: the form check works, nothing else does
set role anon;
select t.eq((ref.signup_available('Budi_Ref', '0857-1234-5678') ->> 'username_free')::boolean, true, 'username free');
select t.eq((ref.signup_available('gipong', '0857-1234-5678') ->> 'username_free')::boolean, true, 'admin-made referral has no username');
select t.eq((ref.signup_available('ab', '0857') ->> 'username_valid')::boolean, false, 'too short username');
select t.eq((ref.signup_available('ab', '0857') ->> 'wa_valid')::boolean, false, 'too short number');
select t.eq((ref.signup_available('x', '0812-1111-1111') ->> 'wa_free')::boolean, false, 'Gipong number taken');
select t.expect_error($$select count(*) from ref.referrers$$, '42501');
select t.expect_error($$select ref.register_me('budi_ref', '0857-1234-5678')$$, '42501');
reset role;

\set u1 '00000000-0000-0000-0000-0000000000e1'
\set u2 '00000000-0000-0000-0000-0000000000e2'
\set u3 '00000000-0000-0000-0000-0000000000e3'
\set ops '00000000-0000-0000-0000-00000000000b'

select set_config('request.jwt.claim.sub', :'u1', false); set role authenticated;
select t.eq(ref.my_role(), null::text, 'fresh login has no role yet');
select t.expect_error($$select ref.submit_participant('X', '0813-1', 'x@x.id', null, null, null, null, true)$$, '42501');
select t.expect_error($$select ref.register_me('orang_lain', '0857-1234-5678')$$, '22023');  -- username must match the login
select t.expect_error($$select ref.register_me('budi_ref', '0812-1111-1111')$$, '23505');    -- number used by Gipong
select t.expect_error($$select ref.register_me('budi_ref', '123')$$, '22023');
select ref.register_me('Budi_Ref', '0857-1234-5678');
select t.eq(ref.my_role(), 'referral', 'referral right after sign-up');
select t.eq(ref.register_me('budi_ref', '0857-1234-5678'), ref.my_referrer_id(), 'calling twice is harmless');
select t.eq((select username::text from ref.referrers), 'budi_ref', 'sees only own referrer row, username lowercased');
select t.eq((select count(*) from ref.participants), 0::bigint, 'new referral sees no one else');
select t.eq((select count(*) from erp.profiles), 0::bigint, 'new referral sees no ERP data');
select ref.submit_participant('Peserta Budi', '0813-7777-0001', 'pb1@mail.id', null, null, null, null, true);
select ref.update_my_profile('Budi Santoso', '0857-1234-5678');
reset role;

select set_config('request.jwt.claim.sub', :'u2', false); set role authenticated;
select t.eq((ref.signup_available('budi_ref', '0857-1234-5678') ->> 'username_free')::boolean, false, 'username now taken');
select t.expect_error($$select ref.register_me('sari.ref', '+62 857 1234 5678')$$, '23505');  -- same number, other format
select ref.register_me('sari.ref', '0857-9999-0000');
reset role;

-- ERP staff cannot turn their login into a referral
select set_config('request.jwt.claim.sub', :'ops', false); set role authenticated;
select t.expect_error($$select ref.register_me('staff', '0857-5555-0000')$$, '22023');
reset role;

-- admin sees the new referrals (and was notified) and can switch one off
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false); set role authenticated;
select t.eq((select count(*) from ref.referrers where username is not null), 2::bigint, 'admin sees self-made referrals');
select t.eq((select count(*) from ref.notifications where kind = 'new_referrer'), 2::bigint, 'admin notified');
select ref.set_referrer_active((select id from ref.referrers where username = 'sari.ref'), false);
reset role;
select set_config('request.jwt.claim.sub', :'u2', false); set role authenticated;
select t.eq(ref.my_role(), null::text, 'switched-off referral loses access');
reset role;

-- log in with username or number (before login, as anon)
set role anon;
select t.eq(ref.login_email('Budi_Ref'), 'budi_ref@referral.tampilresmi.com', 'login by username');
select t.eq(ref.login_email('+62 857-1234-5678'), 'budi_ref@referral.tampilresmi.com', 'login by WhatsApp number, any format');
select t.eq(ref.login_email('tidak_ada'), null::text, 'unknown username');
select t.eq(ref.login_email('sari.ref'), null::text, 'switched-off referral cannot log in through the lookup');
select t.eq(ref.login_email('0812-1111-1111'), 'gipong@x.id', 'admin-made referral logs in by number with their invite email');
reset role;

\echo 'signup: ok'
