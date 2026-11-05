-- Workflow v2: password in Vault, weekdays, H-1 through the referral, 21.00 deadline, rate per referral, settings.
-- Runs after 10_flow.sql / 20_signup.sql in the same database (uses the t.* helpers and the owner/ops logins they made).
\set ON_ERROR_STOP 1
\set QUIET 1

\set owner '00000000-0000-0000-0000-00000000000a'
\set ops '00000000-0000-0000-0000-00000000000b'
\set rc '00000000-0000-0000-0000-0000000000f1'
\set rd '00000000-0000-0000-0000-0000000000f2'

insert into auth.users (id, email) values (:'rc', 'citra@x.id'), (:'rd', 'dewi@x.id');

-- ---------------------------------------------------------------- admin
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select ref.create_referrer('Citra', '0812-3333-3333', 'citra@x.id');
select ref.create_referrer('Dewi', '0812-4444-4444', 'dewi@x.id');
select t.expect_error($$select ref.create_referrer('NoWa', null, null)$$, '22023');          -- the H-1 chat needs a number
select t.expect_error($$select ref.create_referrer('BadWa', '123', null)$$, '22023');
select t.eq((select (value #>> '{}') from ref.settings where key = 'commission_per_completed'), '75000', 'default commission is 75rb');
select ref.set_setting('confirm_deadline', '"23:59"');
reset role;

-- ---------------------------------------------------------------- registering numbers with a password
select set_config('request.jwt.claim.sub', :'rc', false); set role authenticated;
select ref.submit_participant('V2 C' || i, '0813-3000-000' || i, 'v2c' || i || '@mail.id', null, null, '13:00', null, true, 'pw123456',
                              null, case when i = 1 then array[1,3,5]::smallint[] when i = 2 then array[7,1,1,3]::smallint[] when i = 3 then array[1,2,3,4,5,6,7]::smallint[] end)
from generate_series(1, 3) i;
select ref.submit_participant('V2 C' || i, '0813-3000-000' || i, 'v2c' || i || '@mail.id', null, null, '13:00', null, true, 'pw123456')
from generate_series(4, 8) i;
select t.eq((select avail_days from ref.participant_overview where name = 'V2 C1'), array[1,3,5]::smallint[], 'weekdays stored');
select t.eq((select avail_days from ref.participant_overview where name = 'V2 C2'), array[1,3,7]::smallint[], 'weekdays sorted and unique');
select t.eq((select avail_days from ref.participant_overview where name = 'V2 C3'), null::smallint[], 'all seven days = any day');
select t.eq((select count(*) from ref.participant_overview where has_password), 8::bigint, 'has_password flag');
select t.expect_error($$select ref.submit_participant('V2 Short', '0813-3000-0099', 'short@mail.id', null, null, null, null, true, '123')$$, '22023');
select t.expect_error($$select ref.submit_participant('V2 NoPw', '0813-3000-0098', 'nopw@mail.id', null, null, null, null, true, null)$$, '22023');
select t.expect_error($$select ref.submit_participant('V2 Dup', '0813-3000-0001', 'dup@mail.id', null, null, null, null, true, 'pw123456')$$, '23505');
-- the referral cannot read the secrets table, the password, or the helpers
select t.expect_error($$select * from ref.participant_secrets$$, '42501');
select t.expect_error($$select ref.reveal_participant_password((select id from ref.participants where name = 'V2 C1'))$$, '42501');
select t.expect_error($$select ref.clean_days(array[1]::smallint[])$$, '42501');
select t.expect_error($$select ref._apply_confirmation(gen_random_uuid(), 'available')$$, '42501');
select t.expect_error($$select ref.set_setting('daily_target', '30')$$, '42501');
select t.expect_error($$select ref.set_referrer_rate((select id from ref.referrers limit 1), 999999)$$, '42501');
select t.expect_error($$update ref.settings set value = '1'$$, '42501');
reset role;

select set_config('request.jwt.claim.sub', :'rd', false); set role authenticated;
select ref.submit_participant('V2 D' || i, '0813-3000-010' || i, 'v2d' || i || '@mail.id', null, null, '15:00', null, true, 'pw654321') from generate_series(1, 2) i;
reset role;

-- the password sits in Vault, nowhere else
select t.eq((select count(*) from ref.participants where to_jsonb(participants)::text like '%pw123456%'), 0::bigint, 'password is not in ref.participants');
select t.eq((select count(*) from ref.participant_secrets ps join ref.participants p on p.id = ps.participant_id where p.name like 'V2 %'), 10::bigint, 'one secret per number');
select t.eq((select s.secret from ref.participant_secrets ps join vault.secrets s on s.id = ps.secret_id
              join ref.participants p on p.id = ps.participant_id where p.name = 'V2 D1'), 'pw654321', 'secret holds the password');
select t.eq((select count(*) from ref.audit_log where detail::text like '%pw1234%' or detail::text like '%pw6543%'), 0::bigint, 'password not in audit log');
select t.eq((select count(*) from ref.notifications where data::text like '%pw1234%' or data::text like '%pw6543%'), 0::bigint, 'password not in notifications');

-- ---------------------------------------------------------------- review, schedule
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq(ref.review_participants(array(select id from ref.participants where name in ('V2 C1','V2 C2','V2 C3','V2 C4','V2 C5','V2 C6','V2 C7','V2 D1','V2 D2')), 'approve'), 9, 'approved');
-- C1..C3 + C7 on today+2, C4..C6 and D2 today, D1 tomorrow
select ref.schedule_participants(erp.today() + 2, array(select id from ref.participants where name in ('V2 C1','V2 C2','V2 C3','V2 C7')));
select ref.schedule_participants(erp.today(), array(select id from ref.participants where name in ('V2 C4','V2 C5','V2 C6','V2 D2')));
select ref.schedule_participants(erp.today() + 1, array(select id from ref.participants where name = 'V2 D1'));
reset role;

-- ---------------------------------------------------------------- H-1: the team chats the referral
select set_config('request.jwt.claim.sub', :'ops', false); set role authenticated;
select t.eq(ref.mark_referrer_contacted(erp.today() + 2, (select id from ref.referrers where name = 'Citra')), 4, 'four numbers marked contacted');
select t.eq(ref.mark_referrer_contacted(erp.today() + 2, (select id from ref.referrers where name = 'Citra')), 0, 'second chat changes nothing');
select t.eq((select count(*) from ref.participants where name like 'V2 C%' and status = 'confirmation_pending'), 4::bigint, 'status follows');
select t.eq((select confirmation_by_name from ref.entry_overview where name = 'V2 C1'), 'Ops', 'who chatted is visible to the team');
select t.expect_error($$select ref.set_setting('daily_target', '30')$$, '42501');                -- admin only
select t.expect_error($$select ref.set_referrer_rate((select id from ref.referrers where name = 'Citra'), 1)$$, '42501');
select t.expect_error($$select ref.reveal_participant_password((select id from ref.participants where name = 'V2 C1'))$$, '42501');
reset role;

-- ---------------------------------------------------------------- H-1: the referral answers
select set_config('request.jwt.claim.sub', :'rc', false); set role authenticated;
select t.eq(ref.confirm_my_day(erp.today() + 2,
              array(select id from ref.entry_overview where name in ('V2 C1', 'V2 C2')),
              array(select id from ref.entry_overview where name = 'V2 C3'), 'C3 baru bisa sore'),
            '{"ready": 2, "not_ready": 1}'::jsonb, 'answers recorded');
select t.eq((select status::text from ref.participants where name = 'V2 C1'), 'confirmed', 'ready -> confirmed');
select t.eq((select status::text from ref.participants where name = 'V2 C3'), 'waiting_schedule', 'not ready -> waiting for schedule');
select t.eq((select confirmation_by_name from ref.entry_overview where name = 'V2 C1'), null::text, 'referral does not see names of the team');
select t.expect_error($$select ref.confirm_my_day(erp.today() + 2, array[]::uuid[], array[]::uuid[], null)$$, '22023');           -- nothing chosen
select t.expect_error($$select ref.confirm_my_day(erp.today() + 2, array(select id from ref.entry_overview where name = 'V2 C7'), array(select id from ref.entry_overview where name = 'V2 C7'), null)$$, '22023');  -- both lists
select t.expect_error($$select ref.confirm_my_day(erp.today(), array(select id from ref.entry_overview where name = 'V2 C4'), array[]::uuid[], null)$$, '22023');   -- today is closed
select t.expect_error($$select ref.set_confirmation((select id from ref.entry_overview where name = 'V2 C7'), 'available')$$, '42501');
select t.expect_error($$select ref.mark_referrer_contacted(erp.today() + 2, (select id from ref.referrers where name = 'Citra'))$$, '42501');
select t.expect_error($$select ref.complete_entries(array[gen_random_uuid()])$$, '42501');
reset role;

select e.id as c7_entry from ref.schedule_entries e join ref.participants p on p.id = e.participant_id where p.name = 'V2 C7' \gset
select set_config('request.jwt.claim.sub', :'rd', false); set role authenticated;
-- an entry of another referral is refused, not skipped
select t.expect_error(format('select ref.confirm_my_day(erp.today() + 2, array[%L]::uuid[], array[]::uuid[], null)', :'c7_entry'), '42501');
select t.expect_error(format('select ref.confirm_my_day(erp.today() + 2, array[]::uuid[], array[%L]::uuid[], null)', :'c7_entry'), '42501');
select t.eq((select count(*) from ref.entry_overview where name like 'V2 C%'), 0::bigint, 'referral D cannot see Citra''s places');
reset role;
select t.eq((select confirmation::text from ref.schedule_entries e join ref.participants p on p.id = e.participant_id where p.name = 'V2 C7'), 'contacted', 'refused call changed nothing');

select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq((select count(*) from ref.notifications where kind = 'referral_confirmed'), 1::bigint, 'admin told about the answers');
select t.eq((select count(*) from ref.notifications where kind = 'participant_unavailable' and data ->> 'name' = 'V2 C3'), 1::bigint, 'admin told about the number that cannot');
select t.eq((select last_note from ref.entry_overview where name = 'V2 C3'), 'Dari referral: C3 baru bisa sore', 'note from the referral');
select t.eq((select confirmation_by_name from ref.entry_overview where name = 'V2 C1'), 'Citra', 'admin sees who answered');
-- "all ready" only touches numbers without an answer
select t.eq(ref.bulk_confirm(erp.today() + 2, (select id from ref.referrers where name = 'Citra'), 'available'), 1, 'only C7 was unanswered');
select t.eq((select status::text from ref.participants where name = 'V2 C3'), 'waiting_schedule', 'bulk did not override "cannot"');
select t.eq((select status::text from ref.participants where name = 'V2 C7'), 'confirmed', 'bulk confirmed C7');
select t.expect_error($$select ref.bulk_confirm(erp.today() + 2, (select id from ref.referrers where name = 'Citra'), 'not_contacted')$$, '22023');
reset role;

-- ---------------------------------------------------------------- the 21.00 deadline
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select ref.set_setting('confirm_deadline', '"00:00"');                                         -- deadline already passed
reset role;
select set_config('request.jwt.claim.sub', :'rd', false); set role authenticated;
select t.eq(ref.confirm_closed(erp.today() + 1), true, 'tomorrow is closed after the deadline');
select t.eq(ref.confirm_closed(erp.today() + 2), false, 'two days ahead is still open');
select t.expect_error($$select ref.confirm_my_day(erp.today() + 1, array(select id from ref.entry_overview where name = 'V2 D1'), array[]::uuid[], null)$$, '22023');
reset role;
select set_config('request.jwt.claim.sub', :'ops', false); set role authenticated;
select ref.set_confirmation((select id from ref.entry_overview where name = 'V2 D1'), 'waiting');   -- the team can still change it
reset role;
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select ref.set_setting('confirm_deadline', '"23:59"');
reset role;
select set_config('request.jwt.claim.sub', :'rd', false); set role authenticated;
select t.eq(ref.confirm_my_day(erp.today() + 1, array(select id from ref.entry_overview where name = 'V2 D1'), array[]::uuid[], null), '{"ready": 1, "not_ready": 0}'::jsonb, 'open before the deadline');
reset role;

-- ---------------------------------------------------------------- commission per referral
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq(ref.set_referrer_rate((select id from ref.referrers where name = 'Citra'), 100000), 0, 'rate set, nothing pending to change');
select t.eq((select effective_rate from ref.referrer_overview where name = 'Citra'), 100000::bigint, 'effective rate for Citra');
select t.eq((select effective_rate from ref.referrer_overview where name = 'Dewi'), 75000::bigint, 'Dewi keeps the default');
select t.expect_error($$select ref.set_referrer_rate((select id from ref.referrers where name = 'Citra'), -5)$$, '22023');
reset role;

select set_config('request.jwt.claim.sub', :'ops', false); set role authenticated;
select ref.complete_entry((select id from ref.entry_overview where name = 'V2 C4'));
select ref.complete_entry((select id from ref.entry_overview where name = 'V2 D2'));
select t.eq(ref.complete_entries(array(select id from ref.entry_overview where name in ('V2 C5', 'V2 C6'))), 2, 'bulk complete');
select t.expect_error($$select ref.complete_entries(array(select id from ref.entry_overview where name = 'V2 C7'))$$, '22023');   -- future day stops the batch
reset role;

select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq((select amount from ref.commissions c join ref.participants p on p.id = c.participant_id where p.name = 'V2 C4'), 100000::bigint, 'Citra commission at her rate');
select t.eq((select amount from ref.commissions c join ref.participants p on p.id = c.participant_id where p.name = 'V2 D2'), 75000::bigint, 'Dewi commission at the default');
-- a new rate for the ones still waiting, and only those
select ref.verify_commissions(array(select c.id from ref.commissions c join ref.participants p on p.id = c.participant_id where p.name = 'V2 C4'), true);
select t.eq(ref.set_referrer_rate((select id from ref.referrers where name = 'Citra'), 120000, true), 2, 'two pending commissions changed');
select t.eq((select amount from ref.commissions c join ref.participants p on p.id = c.participant_id where p.name = 'V2 C4'), 100000::bigint, 'approved commission is untouched');
select t.eq((select amount from ref.commissions c join ref.participants p on p.id = c.participant_id where p.name = 'V2 C5'), 120000::bigint, 'pending commission follows');
select t.eq(ref.set_referrer_rate((select id from ref.referrers where name = 'Citra'), null, true), 2, 'back to the default for the pending ones');
select t.eq((select commission_rate from ref.referrer_overview where name = 'Citra'), null::bigint, 'no custom rate');
select t.eq((select effective_rate from ref.referrer_overview where name = 'Citra'), 75000::bigint, 'default again');
select t.eq((select count(*) from ref.audit_log where action = 'referrer.rate'), 3::bigint, 'every rate change is logged');
reset role;

select set_config('request.jwt.claim.sub', :'rc', false); set role authenticated;
select t.eq((select count(*) from ref.notifications where kind = 'rate_changed'), 3::bigint, 'Citra was told about each rate change');
select t.eq((select commission_rate from ref.referrers), null::bigint, 'referral can read own rate');
reset role;

-- ---------------------------------------------------------------- report
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq((select (x ->> 'commission')::bigint from jsonb_array_elements(ref.referrer_performance(erp.today(), erp.today())) x where x ->> 'name' = 'Citra'),
            (select sum(amount)::bigint from ref.commissions c join ref.referrers r on r.id = c.referrer_id where r.name = 'Citra' and c.status <> 'void'), 'report commission = commissions made today');
select t.eq((select (x ->> 'completed')::int from jsonb_array_elements(ref.referrer_performance(erp.today(), erp.today())) x where x ->> 'name' = 'Citra'), 3, 'Citra completed 3 today');
select t.eq((select (x ->> 'scheduled')::int from jsonb_array_elements(ref.referrer_performance(erp.today() + 2, erp.today() + 2)) x where x ->> 'name' = 'Citra'), 4, 'Citra has 4 places in two days');
select t.eq((select (x ->> 'ready')::int from jsonb_array_elements(ref.referrer_performance(erp.today() + 2, erp.today() + 2)) x where x ->> 'name' = 'Citra'), 3, 'three ready');
select t.eq((select (x ->> 'not_ready')::int from jsonb_array_elements(ref.referrer_performance(erp.today() + 2, erp.today() + 2)) x where x ->> 'name' = 'Citra'), 1, 'one cannot');
select t.eq((select (x ->> 'commission')::bigint from jsonb_array_elements(ref.referrer_performance(erp.today() + 5, erp.today() + 9)) x where x ->> 'name' = 'Citra'), 0::bigint, 'no commission in a period without completions');
reset role;

-- ---------------------------------------------------------------- password: reveal and reject
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq(ref.reveal_participant_password((select id from ref.participants where name = 'V2 C1')), 'pw123456', 'owner can reveal');
select t.eq((select count(*) from ref.audit_log where action = 'participant.password_reveal'), 1::bigint, 'reveal is logged');
select t.eq(ref.reveal_participant_password((select id from ref.participants where name = 'V2 C1'), 'copy'), 'pw123456', 'reveal for copy');
select t.eq((select count(*) from ref.audit_log where action = 'participant.password_copy'), 1::bigint, 'copy is logged');
select t.eq(ref.review_participants(array(select id from ref.participants where name = 'V2 C8'), 'reject', 'Nomor tidak aktif'), 1, 'rejected');
select t.eq((select has_password from ref.participant_overview where name = 'V2 C8'), false, 'rejected number has no password');
select t.eq(ref.reveal_participant_password((select id from ref.participants where name = 'V2 C8')), null::text, 'nothing left to reveal');
reset role;
select t.eq((select count(*) from vault.secrets where name = 'ref_participant_' || (select id from ref.participants where name = 'V2 C8')), 0::bigint, 'secret deleted from Vault');
select t.eq((select count(*) from ref.participant_secrets where participant_id = (select id from ref.participants where name = 'V2 C8')), 0::bigint, 'link deleted');

select set_config('request.jwt.claim.sub', :'rc', false); set role authenticated;
-- sending the rejected number again needs a password again
select t.expect_error($$select ref.submit_participant('V2 C8', '0813-3000-0008', 'v2c8@mail.id', null, null, null, null, true, '')$$, '22023');
select ref.submit_participant('V2 C8', '0813-3000-0008', 'v2c8@mail.id', null, null, null, null, true, 'pw-new-123');
select t.eq((select count(*) from ref.participant_overview where name = 'V2 C8' and has_password), 1::bigint, 'new submission has a password');
-- a referral may change the password of a number that is still Submitted
select ref.update_my_participant((select id from ref.participants where name = 'V2 C8' and status = 'submitted'), 'V2 C8', '0813-3000-0008', 'v2c8@mail.id', null, null, null, null, array[2,4]::smallint[], 'pw-newer-123');
select t.eq((select avail_days from ref.participant_overview where name = 'V2 C8' and status = 'submitted'), array[2,4]::smallint[], 'weekdays updated');
reset role;
select t.eq((select s.secret from ref.participant_secrets ps join vault.secrets s on s.id = ps.secret_id join ref.participants p on p.id = ps.participant_id
              where p.name = 'V2 C8' and p.status = 'submitted'), 'pw-newer-123', 'password replaced in place');

select set_config('request.jwt.claim.sub', :'ops', false); set role authenticated;
select t.expect_error($$select ref.reveal_participant_password((select id from ref.participants where name = 'V2 C1'))$$, '42501');   -- staff is not in password_reveal_roles
reset role;

-- link to an ERP account hands the password over (only checked against the small ERP stub; the real ERP table has more required columns)
select count(*) = 3 as stub from information_schema.columns where table_schema = 'erp' and table_name = 'accounts' \gset
\if :stub
insert into erp.accounts (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'v2c1@mail.id');
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select ref.link_erp_account((select id from ref.participants where name = 'V2 C1'), '00000000-0000-0000-0000-0000000000a1');
reset role;
select t.eq((select s.secret from erp.accounts a join vault.secrets s on s.id = a.password_secret_id where a.id = '00000000-0000-0000-0000-0000000000a1'), 'pw123456', 'password handed to the ERP account');
\endif

-- ---------------------------------------------------------------- settings
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select ref.set_setting('commission_per_completed', '80000');
select t.eq((select (value #>> '{}') from ref.settings where key = 'commission_per_completed'), '80000', 'default commission changed');
select ref.set_setting('commission_per_completed', '75000');
select ref.set_setting('admin_wa', '"0812-9932-3591"');
select t.eq((select (value #>> '{}') from ref.settings where key = 'admin_wa'), '6281299323591', 'admin WhatsApp normalised');
select t.expect_error($$select ref.set_setting('login_email_domain', '"evil.com"')$$, '22023');          -- not editable
select t.expect_error($$select ref.set_setting('confirm_deadline', '"25:00"')$$, '22023');
select t.expect_error($$select ref.set_setting('commission_per_completed', '-1')$$, '22023');
select t.expect_error($$select ref.set_setting('commission_per_completed', '"lots"')$$, '22023');
select t.expect_error($$select ref.set_setting('daily_target', '501')$$, '22023');
select t.expect_error($$select ref.set_setting('withdraw_presets', '[]')$$, '22023');
select t.expect_error($$select ref.set_setting('wa_referral_h1_template', '"x"')$$, '22023');
select ref.set_setting('daily_target', '30');
select t.eq((select (d ->> 'target')::int from jsonb_array_elements(ref.calendar(erp.today() + 20, erp.today() + 20)) d), 30, 'a new default target applies to days without their own');
select ref.set_setting('daily_target', '20');
select t.expect_error($$update ref.settings set value = '1'$$, '42501');
reset role;

-- ---------------------------------------------------------------- anon can call none of it
set role anon;
select t.expect_error($$select ref.set_setting('daily_target', '30')$$, '42501');
select t.expect_error($$select ref.confirm_my_day(current_date + 2, array[]::uuid[], array[]::uuid[], null)$$, '42501');
select t.expect_error($$select ref.reveal_participant_password(gen_random_uuid())$$, '42501');
select t.expect_error($$select ref.submit_participant('x', '0813-1', 'x@x.id', null, null, null, null, true, 'pw123456')$$, '42501');
select t.expect_error($$select ref.confirm_closed(current_date)$$, '42501');
select t.expect_error($$select ref.effective_rate(gen_random_uuid())$$, '42501');
select t.expect_error($$select * from ref.entry_overview$$, '42501');
reset role;

\echo 'workflow v2: ok'
