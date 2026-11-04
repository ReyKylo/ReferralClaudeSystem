-- End-to-end flow through the RPCs, as the real roles, with RLS on.
\set ON_ERROR_STOP 1
\set QUIET 1

-- ---------------------------------------------------------------- fixtures (as superuser)
create schema t;
create function t.expect_error(p_sql text, p_state text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error % but statement succeeded: %', p_state, p_sql;
exception when others then
  if sqlstate <> p_state then raise exception 'expected % got % (%) for: %', p_state, sqlstate, sqlerrm, p_sql; end if;
end $$;
create function t.eq(p_got anyelement, p_want anyelement, p_what text) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then raise exception '%: got %, want %', p_what, p_got, p_want; end if;
end $$;
grant usage on schema t to authenticated, anon;
grant execute on all functions in schema t to authenticated, anon;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@x.id'),
  ('00000000-0000-0000-0000-00000000000b', 'staff@x.id'),
  ('00000000-0000-0000-0000-00000000000c', 'gipong@x.id'),
  ('00000000-0000-0000-0000-00000000000d', 'zakar@x.id');
insert into erp.profiles (user_id, display_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Owner', 'owner'),
  ('00000000-0000-0000-0000-00000000000b', 'Ops', 'staff');

\set owner '00000000-0000-0000-0000-00000000000a'
\set ops '00000000-0000-0000-0000-00000000000b'
\set ra '00000000-0000-0000-0000-00000000000c'
\set rb '00000000-0000-0000-0000-00000000000d'

-- ---------------------------------------------------------------- admin creates referrals
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq(ref.my_role(), 'admin', 'owner maps to admin');
select ref.create_referrer('Gipong', '0812-1111-1111', 'gipong@x.id');
select ref.create_referrer('Zakar', '0812-2222-2222', 'zakar@x.id');
select t.expect_error($$select ref.create_referrer('X', null, 'staff@x.id')$$, '22023');  -- ERP login cannot be a referral
reset role;

-- ---------------------------------------------------------------- Phase 1: registration + isolation
select set_config('request.jwt.claim.sub', :'ra', false); set role authenticated;
select t.eq(ref.my_role(), 'referral', 'referral role');
select t.eq((select count(*) from erp.accounts), 0::bigint, 'referral sees no ERP data');
select ref.submit_participant('Peserta ' || i, '0813-0000-00' || lpad(i::text, 2, '0'), 'p' || i || '@mail.id',
                              'cloud-' || i, null, '10:00', null, true)
from generate_series(1, 4) i;
select t.expect_error($$select ref.submit_participant('Dup', '+62 813 0000 0001', 'other@mail.id', null, null, null, null, true)$$, '23505');
select t.expect_error($$select ref.submit_participant('Dup', '0813-9999-9999', 'P1@MAIL.ID', null, null, null, null, true)$$, '23505');
select t.expect_error($$select ref.submit_participant('NoConsent', '0813-9999-9999', 'nc@mail.id', null, null, null, null, false)$$, '22023');
select t.expect_error($$insert into ref.participants (referrer_id, name, wa, email, consent_wa) values (ref.my_referrer_id(), 'x', '081300000099', 'x@x.id', true)$$, '42501');
select t.expect_error($$update ref.participants set status = 'approved'$$, '42501');
select t.expect_error($$select ref.review_participants(array(select id from ref.participants), 'approve')$$, '42501');
select t.eq((select count(*) from ref.participant_overview), 4::bigint, 'referral A sees own 4');
select t.eq((select count(*) from ref.participant_events), 4::bigint, 'status history written on submit');
reset role;

select set_config('request.jwt.claim.sub', :'rb', false); set role authenticated;
select t.eq((select count(*) from ref.participants), 0::bigint, 'referral B sees none of A');
select t.eq((select count(*) from ref.notifications), 0::bigint, 'referral B sees no notifications of A');
select t.expect_error($$select ref.request_withdrawal(1)$$, '22023');
reset role;

select set_config('request.jwt.claim.sub', :'ops', false); set role authenticated;
select t.eq(ref.my_role(), 'ops', 'staff maps to ops');
select t.eq((select count(*) from ref.participants), 0::bigint, 'ops sees nobody before scheduling');
select t.eq((select count(*) from ref.commissions), 0::bigint, 'ops sees no commissions');
select t.expect_error($$select ref.schedule_participants(erp.today() + 1, '{}')$$, '42501');
reset role;

-- ---------------------------------------------------------------- admin review + schedule
select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq((select count(*) from ref.participant_overview), 4::bigint, 'admin sees all');
select t.eq(ref.review_participants(array(select id from ref.participants where name in ('Peserta 1','Peserta 2','Peserta 3')), 'approve'), 3, 'approved 3');
select t.expect_error($$select ref.review_participants(array(select id from ref.participants where name = 'Peserta 4'), 'reject')$$, '22023');
select t.eq(ref.review_participants(array(select id from ref.participants where name = 'Peserta 4'), 'reject', 'Nomor tidak aktif'), 1, 'rejected 1');
select t.expect_error($$select ref.schedule_participants(erp.today() + 1, array(select id from ref.participants where name = 'Peserta 4'))$$, '22023');

select ref.set_day_target(erp.today() + 1, 2);
select t.expect_error($$select ref.schedule_participants(erp.today() + 1, array(select id from ref.participants where status = 'approved'))$$, '23514');
select t.eq((select count(*) from ref.schedule_entries), 0::bigint, 'capacity error rolled back everything');
select ref.schedule_participants(erp.today() + 1, array(select id from ref.participants where name in ('Peserta 1', 'Peserta 2')));
select ref.schedule_participants(erp.today(), array(select id from ref.participants where name = 'Peserta 3'), '09:00');
select t.eq((select (d ->> 'status') from jsonb_array_elements(ref.calendar(erp.today() + 1, erp.today() + 1)) d), 'planned', 'tomorrow planned');
select t.eq((select (d ->> 'status') from jsonb_array_elements(ref.calendar(erp.today() + 2, erp.today() + 2)) d), 'not_planned', 'day+2 not planned');
select t.eq((select (d ->> 'target')::int from jsonb_array_elements(ref.calendar(erp.today() + 2, erp.today() + 2)) d), 20, 'default target 20');

-- move Peserta 2 to day+2: one active place, old one marked moved
select ref.schedule_participants(erp.today() + 2, array(select id from ref.participants where name = 'Peserta 2'));
select t.eq((select count(*) from ref.schedule_entries e join ref.participants p on p.id = e.participant_id where p.name = 'Peserta 2' and e.state = 'active'), 1::bigint, 'one active place after move');
select t.eq((select count(*) from ref.schedule_entries where state = 'moved' and moved_to is not null), 1::bigint, 'old place marked moved');
select t.eq((select (d ->> 'remaining')::int from jsonb_array_elements(ref.calendar(erp.today() + 1, erp.today() + 1)) d), 1, 'tomorrow has 1 open place after move');
reset role;

-- ---------------------------------------------------------------- H-1 confirmation by ops
select set_config('request.jwt.claim.sub', :'ops', false); set role authenticated;
select t.eq((select count(*) from ref.entry_overview where day = erp.today() + 1), 1::bigint, 'ops sees tomorrow list');
select ref.set_confirmation((select id from ref.entry_overview where name = 'Peserta 1'), 'waiting');
select t.eq((select status::text from ref.participants where name = 'Peserta 1'), 'confirmation_pending', 'waiting -> confirmation pending');
select ref.set_confirmation((select id from ref.entry_overview where name = 'Peserta 1'), 'unavailable', 'Ada acara keluarga');
select t.eq((select status::text from ref.participants where name = 'Peserta 1'), 'waiting_schedule', 'unavailable -> waiting for schedule');
select t.eq((select (d ->> 'unavailable')::int from jsonb_array_elements(ref.calendar(erp.today() + 1, erp.today() + 1)) d), 1, 'calendar counts unavailable');
select t.eq((select (d ->> 'remaining')::int from jsonb_array_elements(ref.calendar(erp.today() + 1, erp.today() + 1)) d), 2, 'unavailable place counts as open');
select t.expect_error($$select ref.complete_entry((select id from ref.entry_overview where name = 'Peserta 1'))$$, '22023');  -- future day
select ref.set_confirmation((select id from ref.entry_overview where name = 'Peserta 3'), 'available');
select ref.complete_entry((select id from ref.entry_overview where name = 'Peserta 3'), 'Selesai jam 10');
select t.eq((select status::text from ref.participants where name = 'Peserta 3'), 'completed', 'completed');
select t.eq((select count(*) from ref.commissions), 0::bigint, 'ops still sees no commissions');
select t.eq((select last_note from ref.entry_overview where name = 'Peserta 3'), 'Selesai jam 10', 'ops note kept');
reset role;

-- ---------------------------------------------------------------- Phase 3: wallet
select set_config('request.jwt.claim.sub', :'ra', false); set role authenticated;
select t.eq((select pending_commission from ref.wallets), 50000::bigint, 'pending 50rb');
select t.eq((select available from ref.wallets), 0::bigint, 'nothing available before verification');
select t.eq((select count(*) from ref.ops_notes), 0::bigint, 'referral cannot read internal notes');
select t.eq((select count(*) from ref.participant_events where kind = 'confirmation'), 0::bigint, 'referral cannot read confirmation events');
reset role;

select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.eq(ref.verify_commissions(array(select id from ref.commissions), true), 1, 'verified');
select t.eq(ref.verify_commissions(array(select id from ref.commissions), false), 0, 'approved cannot be voided');
reset role;

select set_config('request.jwt.claim.sub', :'ra', false); set role authenticated;
select t.eq((select available from ref.wallets), 50000::bigint, 'available after verification');
select t.expect_error($$select ref.request_withdrawal(50000)$$, '22023');  -- no payout account yet
select ref.update_my_payout('BCA', '1234567890', 'Gipong');
select t.expect_error($$select ref.request_withdrawal(60000)$$, '22023');  -- more than balance
select t.expect_error($$select ref.request_withdrawal(10000)$$, '22023');  -- under minimum
select ref.request_withdrawal(50000);
select t.eq((select available from ref.wallets), 0::bigint, 'balance on hold');
select t.eq((select on_hold from ref.wallets), 50000::bigint, 'on hold 50rb');
select t.expect_error($$select ref.request_withdrawal(50000)$$, '22023');  -- no double withdrawal
select t.expect_error($$update ref.withdrawals set status = 'paid'$$, '42501');
reset role;

select set_config('request.jwt.claim.sub', :'owner', false); set role authenticated;
select t.expect_error($$select ref.mark_withdrawal_paid((select id from ref.withdrawals), 'TRX1')$$, '22023');  -- not approved yet
select ref.decide_withdrawal((select id from ref.withdrawals), true);
select t.expect_error($$select ref.mark_withdrawal_paid((select id from ref.withdrawals), '')$$, '22023');  -- needs proof
select ref.mark_withdrawal_paid((select id from ref.withdrawals), 'BCA TRX 0001');
select t.eq((select count(*) from ref.audit_log where action like 'withdrawal.%'), 3::bigint, 'withdrawal audit trail');
select t.eq(jsonb_array_length(ref.referrer_performance(erp.today() - 30, erp.today())), 2, 'referrer report rows');
select t.eq((select (x ->> 'completed')::int from jsonb_array_elements(ref.referrer_performance(erp.today() - 30, erp.today())) x where x ->> 'name' = 'Gipong'), 1, 'Gipong completed 1');
select t.eq((select (x ->> 'paid')::int from jsonb_array_elements(ref.referrer_performance(erp.today() - 30, erp.today())) x where x ->> 'name' = 'Gipong'), 50000, 'Gipong paid 50rb');
select t.eq(jsonb_array_length(ref.ops_performance(erp.today(), erp.today() + 6, 'day')), 7, 'ops report 7 days');
select t.eq((select (x ->> 'rescheduled')::int from jsonb_array_elements(ref.ops_performance(erp.today(), erp.today() + 6, 'week')) x limit 1) >= 0, true, 'week bucket works');
select ref.app_counts();
reset role;

select set_config('request.jwt.claim.sub', :'ra', false); set role authenticated;
select t.eq((select withdrawn from ref.wallets), 50000::bigint, 'withdrawn 50rb');
select t.eq((select available from ref.wallets), 0::bigint, 'available 0 after payout');
select t.eq((select count(*) from ref.audit_log), 0::bigint, 'referral cannot read audit log');
select t.eq((select array_agg(kind order by id) from ref.notifications),
            array['registration_submitted','registration_submitted','registration_submitted','registration_submitted',
                  'registration_approved','registration_approved','registration_approved','registration_rejected',
                  'schedule_assigned','schedule_assigned','schedule_assigned','schedule_changed',
                  'commission_approved','withdrawal_approved','payment_completed'], 'referral notifications');
select t.eq(ref.mark_notifications_read(), 15, 'mark all read');
select t.eq((ref.app_counts() ->> 'unread')::int, 0, 'unread 0');
reset role;

\echo 'flow: ok'
