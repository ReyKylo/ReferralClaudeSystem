-- Stable withdrawal request numbers (TS-0001, TS-0002, ...).
-- STATUS: applied to the Supabase project vfttmslrjimbndseqqko on 2026-11-05.
--
-- ref.withdrawal_items used row_number() over the rows the caller can see, so a referral (who sees only their own
-- requests) and the admin (who sees all) could see different numbers for the same request. The number is now stored.
alter table ref.withdrawals add column request_seq bigint generated always as identity;
create unique index withdrawals_request_seq_key on ref.withdrawals (request_seq);

create or replace view ref.withdrawal_items with (security_invoker = true) as
select w.id, w.referrer_id, r.name as referrer_name, r.username, r.wa as referrer_wa,
       w.amount, w.status, w.payout_method, w.payout_account, w.payout_name,
       w.requested_at, w.decided_at, w.decision_note, w.paid_at, w.payment_reference, w.proof_path,
       'TS-' || lpad(w.request_seq::text, 4, '0') as request_no
from ref.withdrawals w
join ref.referrers r on r.id = w.referrer_id;
