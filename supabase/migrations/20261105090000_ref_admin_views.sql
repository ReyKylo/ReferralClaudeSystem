-- Read models for the referral screens inside ERP Claude Kita (admin and operations).
-- STATUS: NOT applied yet (together with the two earlier ref migrations).
-- All views are security_invoker, so the RLS of ref.* decides what each role sees.

-- Withdrawal requests with who asked and where to send the money.
create view ref.withdrawal_items with (security_invoker = true) as
select w.id, w.referrer_id, r.name as referrer_name, r.username, r.wa as referrer_wa,
       w.amount, w.status, w.payout_method, w.payout_account, w.payout_name,
       w.requested_at, w.decided_at, w.decision_note, w.paid_at, w.payment_reference, w.proof_path,
       'TS-' || lpad(row_number() over (order by w.requested_at, w.id)::text, 4, '0') as request_no
from ref.withdrawals w
join ref.referrers r on r.id = w.referrer_id;

-- One row per referral: contact, who invited them, how many participants, and their wallet.
create view ref.referrer_overview with (security_invoker = true) as
select r.id, r.name, r.username, r.wa, r.wa_norm, r.active, r.created_at,
       r.payout_method, r.payout_account, r.payout_name,
       inv.name as invited_by_name,
       (select count(*) from ref.referrers x where x.invited_by = r.id) as invited_count,
       (select count(*) from ref.participants p where p.referrer_id = r.id) as participants,
       (select count(*) from ref.participants p where p.referrer_id = r.id and p.status = 'completed') as completed,
       w.total_commission, w.pending_commission, w.approved_commission, w.on_hold, w.withdrawn, w.available
from ref.referrers r
left join ref.referrers inv on inv.id = r.invited_by
left join ref.wallets w on w.referrer_id = r.id;

grant select on ref.withdrawal_items, ref.referrer_overview to authenticated;
