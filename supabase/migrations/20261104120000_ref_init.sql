-- Referral Claude System: database for the Referral Portal and the referral screens inside ERP Claude Kita.
-- STATUS: applied to the Supabase project vfttmslrjimbndseqqko on 2026-11-05 (owner agreed).
--
-- One central database: this lives in the same Supabase project as the ERP (vfttmslrjimbndseqqko), in its own schema
-- `ref`, and needs the `erp` schema (erp.today, erp.normalize_wa, erp.profiles, erp.accounts) to exist first.
--
-- Security model
--   * Every write goes through a SECURITY DEFINER function below that checks the caller's role and validates the data.
--     Tables only have SELECT policies, so nobody can change a status, a schedule, a commission or a balance by
--     writing to a table directly through the API.
--   * Roles: ERP owner/admin = 'admin', ERP staff = 'ops', a row in ref.referrers linked to the login = 'referral'.
--     A referral never gets an erp.profiles row, so the ERP's own RLS keeps hiding all ERP data from them.
--   * A referral only ever sees participants, schedules, commissions and withdrawals of their own referrer row.
--   * No passwords or payment credentials of participants are stored anywhere in this schema.
--   * Everything that matters is written to ref.participant_events (status history) and ref.audit_log.
--
-- Time zone: "today" is Asia/Jakarta (WIB), via erp.today().

create schema if not exists ref;

-- ---------------------------------------------------------------- types
create type ref.participant_status as enum (
  'submitted', 'under_review', 'approved', 'waiting_schedule', 'scheduled',
  'confirmation_pending', 'confirmed', 'completed', 'rejected'
);
create type ref.confirmation_status as enum (
  'not_contacted', 'contacted', 'waiting', 'available', 'unavailable', 'reschedule'
);
-- active = holds a place on its day; moved = replaced by a newer entry; cancelled = taken off the schedule;
-- completed = the work was done on that day.
create type ref.entry_state as enum ('active', 'moved', 'cancelled', 'completed');
create type ref.commission_status as enum ('pending', 'approved', 'void');
create type ref.withdrawal_status as enum ('requested', 'approved', 'rejected', 'cancelled', 'paid');

-- ---------------------------------------------------------------- settings
create table ref.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into ref.settings (key, value) values
  ('daily_target', '20'),
  ('commission_per_completed', '50000'),
  ('withdraw_presets', '[100000, 200000, 300000, 500000]'),
  ('withdraw_min', '50000'),
  ('wa_confirm_template', '"Halo {name}, kami dari tim Claude Kita. Mau memastikan jadwal Anda besok, {date} jam {time}. Apakah Anda tersedia? Balas YA atau TIDAK. Terima kasih."');

create or replace function ref.setting_int(p_key text)
returns int language sql stable set search_path = ''
as $$ select (value #>> '{}')::int from ref.settings where key = p_key $$;

-- ---------------------------------------------------------------- referrers
create table ref.referrers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  wa text,
  wa_norm text generated always as (erp.normalize_wa(wa)) stored,
  -- Where withdrawals are paid to. Filled in by the referral in the portal.
  payout_method text,           -- e.g. BCA, Mandiri, DANA, GoPay
  payout_account text,          -- account / phone number
  payout_name text,             -- account holder name
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index referrers_wa_norm_key on ref.referrers (wa_norm) where wa_norm is not null;

-- ---------------------------------------------------------------- roles
create or replace function ref.my_role()
returns text language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select case when p.role in ('owner', 'admin') then 'admin' when p.role = 'staff' then 'ops' end
       from erp.profiles p where p.user_id = auth.uid()),
    (select 'referral' from ref.referrers r where r.user_id = auth.uid() and r.active)
  )
$$;

create or replace function ref.my_referrer_id()
returns uuid language sql stable security definer set search_path = ''
as $$ select id from ref.referrers where user_id = auth.uid() and active $$;

create or replace function ref.require_role(variadic p_roles text[])
returns text language plpgsql stable security definer set search_path = ''
as $$
declare v text := ref.my_role();
begin
  if v is null or not (v = any (p_roles)) then
    raise exception 'Tidak punya akses' using errcode = '42501';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------- participants
create table ref.participants (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references ref.referrers (id),
  name text not null check (length(trim(name)) > 0),
  wa text not null,
  wa_norm text generated always as (erp.normalize_wa(wa)) stored check (length(wa_norm) between 10 and 15),
  email extensions.citext not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  -- Reference to the cloud account (an ID or label). Never a password.
  cloud_ref text,
  avail_date date,
  avail_time time,
  notes text,
  -- The participant agreed to be contacted on WhatsApp. Required to register.
  consent_wa boolean not null check (consent_wa),
  status ref.participant_status not null default 'submitted',
  reject_reason text,
  -- Optional link to the account this participant ended up as in the ERP.
  erp_account_id uuid references erp.accounts (id) on delete set null,
  entered_on date not null default erp.today(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
-- Duplicate registration: one live registration per WhatsApp number and per email, across all referrals.
create unique index participants_wa_live_key on ref.participants (wa_norm) where status <> 'rejected';
create unique index participants_email_live_key on ref.participants (email) where status <> 'rejected';
create index participants_referrer_idx on ref.participants (referrer_id, created_at desc);
create index participants_status_idx on ref.participants (status, created_at desc);
create index participants_entered_idx on ref.participants (entered_on);

-- Status history and other events per participant. Written by triggers and RPCs only.
create table ref.participant_events (
  id bigint generated always as identity primary key,
  participant_id uuid not null references ref.participants (id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  kind text not null,          -- status | schedule | confirmation | note
  from_value text,
  to_value text,
  detail jsonb not null default '{}'
);
create index participant_events_idx on ref.participant_events (participant_id, at desc);

-- Internal notes by admin / operations. Never visible to the referral.
create table ref.ops_notes (
  id bigint generated always as identity primary key,
  participant_id uuid not null references ref.participants (id) on delete cascade,
  note text not null check (length(trim(note)) > 0),
  at timestamptz not null default now(),
  actor uuid default auth.uid()
);
create index ops_notes_idx on ref.ops_notes (participant_id, at desc);

-- ---------------------------------------------------------------- scheduling
-- A row exists only for days whose target differs from settings.daily_target, or that were scheduled on.
create table ref.schedule_days (
  day date primary key,
  target int not null check (target between 0 and 500),
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table ref.schedule_entries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references ref.participants (id) on delete cascade,
  day date not null,
  start_time time,
  state ref.entry_state not null default 'active',
  confirmation ref.confirmation_status not null default 'not_contacted',
  confirmation_at timestamptz,
  confirmation_by uuid,
  moved_to uuid references ref.schedule_entries (id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
-- A participant holds at most one place at a time, so they can never be booked twice at overlapping times.
create unique index schedule_entries_one_active_key on ref.schedule_entries (participant_id) where state = 'active';
create index schedule_entries_day_idx on ref.schedule_entries (day, state);

-- ---------------------------------------------------------------- money
create table ref.commissions (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references ref.referrers (id),
  participant_id uuid not null references ref.participants (id),
  amount bigint not null check (amount >= 0),
  status ref.commission_status not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create unique index commissions_one_per_participant on ref.commissions (participant_id) where status <> 'void';
create index commissions_referrer_idx on ref.commissions (referrer_id, status);

create table ref.withdrawals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references ref.referrers (id),
  amount bigint not null check (amount > 0),
  status ref.withdrawal_status not null default 'requested',
  -- Snapshot of where to pay, taken when the request was made.
  payout_method text not null,
  payout_account text not null,
  payout_name text not null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,
  paid_at timestamptz,
  paid_by uuid,
  payment_reference text,      -- transfer reference / note
  proof_path text,             -- object path in the storage bucket ref-payment-proofs
  check (status <> 'paid' or (paid_at is not null and (payment_reference is not null or proof_path is not null)))
);
create index withdrawals_referrer_idx on ref.withdrawals (referrer_id, requested_at desc);
create index withdrawals_open_idx on ref.withdrawals (status) where status in ('requested', 'approved');

-- ---------------------------------------------------------------- notifications + audit
create table ref.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,          -- see docs/PLAN.md section 9; the UI turns kind + data into a sentence
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_idx on ref.notifications (user_id, created_at desc);
create index notifications_unread_idx on ref.notifications (user_id) where read_at is null;

create table ref.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  action text not null,
  entity text,
  entity_id text,
  detail jsonb not null default '{}'
);
create index audit_log_at_idx on ref.audit_log (at desc);
create index audit_log_entity_idx on ref.audit_log (entity, entity_id);

create or replace function ref.audit(p_action text, p_entity text, p_entity_id text, p_detail jsonb default '{}')
returns void language sql security definer set search_path = ''
as $$ insert into ref.audit_log (action, entity, entity_id, detail) values (p_action, p_entity, p_entity_id, coalesce(p_detail, '{}')) $$;

create or replace function ref.notify_referrer(p_referrer_id uuid, p_kind text, p_data jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into ref.notifications (user_id, kind, data)
  select r.user_id, p_kind, coalesce(p_data, '{}') from ref.referrers r where r.id = p_referrer_id and r.user_id is not null
$$;

create or replace function ref.notify_admins(p_kind text, p_data jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into ref.notifications (user_id, kind, data)
  select p.user_id, p_kind, coalesce(p_data, '{}') from erp.profiles p where p.role in ('owner', 'admin')
$$;

-- ---------------------------------------------------------------- triggers
create or replace function ref.participants_track()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into ref.participant_events (participant_id, kind, to_value) values (new.id, 'status', new.status::text);
    return new;
  end if;
  new.updated_at := now();
  if new.status is distinct from old.status then
    insert into ref.participant_events (participant_id, kind, from_value, to_value)
    values (new.id, 'status', old.status::text, new.status::text);
  end if;
  return new;
end $$;
create trigger participants_track_ins after insert on ref.participants
  for each row execute function ref.participants_track();
create trigger participants_track_upd before update on ref.participants
  for each row execute function ref.participants_track();

-- ---------------------------------------------------------------- read models (RLS applies via security_invoker)
-- The entry that describes a participant's schedule now: the active one, otherwise the latest.
create view ref.participant_overview with (security_invoker = true) as
select
  p.id, p.referrer_id, r.name as referrer_name,
  p.name, p.wa, p.wa_norm, p.email, p.cloud_ref, p.avail_date, p.avail_time, p.notes, p.consent_wa,
  p.status, p.reject_reason, p.erp_account_id, p.entered_on, p.created_at, p.updated_at,
  e.id as entry_id, e.day as scheduled_day, e.start_time as scheduled_time, e.state as entry_state,
  e.confirmation
from ref.participants p
join ref.referrers r on r.id = p.referrer_id
left join lateral (
  select * from ref.schedule_entries se
  where se.participant_id = p.id and se.state in ('active', 'completed')
  order by (se.state = 'active') desc, se.day desc
  limit 1
) e on true;

-- One row per booked place: the H-1 confirmation list and the day board.
create view ref.entry_overview with (security_invoker = true) as
select
  e.id, e.day, e.start_time, e.state, e.confirmation, e.confirmation_at, e.completed_at,
  p.id as participant_id, p.name, p.wa, p.wa_norm, p.email, p.cloud_ref, p.consent_wa, p.status,
  r.id as referrer_id, r.name as referrer_name,
  (select n.note from ref.ops_notes n where n.participant_id = p.id order by n.at desc limit 1) as last_note
from ref.schedule_entries e
join ref.participants p on p.id = e.participant_id
join ref.referrers r on r.id = p.referrer_id
where e.state in ('active', 'completed');

-- Wallet per referral. available = approved - on hold (requested/approved withdrawals) - paid out.
create view ref.wallets with (security_invoker = true) as
with c as (
  select referrer_id,
         sum(amount) filter (where status <> 'void') as total,
         sum(amount) filter (where status = 'pending') as pending,
         sum(amount) filter (where status = 'approved') as approved
  from ref.commissions group by referrer_id
), w as (
  select referrer_id,
         sum(amount) filter (where status in ('requested', 'approved')) as on_hold,
         sum(amount) filter (where status = 'paid') as withdrawn
  from ref.withdrawals group by referrer_id
)
select r.id as referrer_id, r.name,
       coalesce(c.total, 0)::bigint as total_commission,
       coalesce(c.pending, 0)::bigint as pending_commission,
       coalesce(c.approved, 0)::bigint as approved_commission,
       coalesce(w.on_hold, 0)::bigint as on_hold,
       coalesce(w.withdrawn, 0)::bigint as withdrawn,
       (coalesce(c.approved, 0) - coalesce(w.on_hold, 0) - coalesce(w.withdrawn, 0))::bigint as available
from ref.referrers r
left join c on c.referrer_id = r.id
left join w on w.referrer_id = r.id;

create view ref.commission_items with (security_invoker = true) as
select cm.id, cm.referrer_id, r.name as referrer_name, cm.participant_id, p.name as participant_name, p.email,
       cm.amount, cm.status, cm.created_at, cm.decided_at
from ref.commissions cm
join ref.referrers r on r.id = cm.referrer_id
join ref.participants p on p.id = cm.participant_id;

-- Same numbers as ref.wallets for one referrer, computed without RLS (used inside the money RPCs, under a row lock).
create or replace function ref.available_balance(p_referrer_id uuid)
returns bigint language sql stable security definer set search_path = ''
as $$
  select (
    coalesce((select sum(amount) from ref.commissions where referrer_id = p_referrer_id and status = 'approved'), 0)
    - coalesce((select sum(amount) from ref.withdrawals where referrer_id = p_referrer_id and status in ('requested', 'approved', 'paid')), 0)
  )::bigint
$$;

-- ---------------------------------------------------------------- day numbers
-- Per day: target (schedule_days or settings.daily_target), and how the booked places stand.
--   scheduled   = places on the day (active + completed)
--   unavailable = active places whose participant said no / must reschedule (they still count until moved)
--   remaining   = target - (scheduled - unavailable)
create or replace function ref.calendar(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_default int := coalesce(ref.setting_int('daily_target'), 20);
begin
  perform ref.require_role('admin', 'ops');
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'Rentang tanggal tidak valid' using errcode = '22023';
  end if;
  return (
    with days as (select g::date as day from generate_series(p_from, p_to, interval '1 day') g),
    agg as (
      select e.day,
             count(*) as scheduled,
             count(*) filter (where e.confirmation = 'available') as confirmed,
             count(*) filter (where e.state = 'active' and e.confirmation in ('not_contacted', 'contacted', 'waiting')) as pending,
             count(*) filter (where e.state = 'active' and e.confirmation in ('unavailable', 'reschedule')) as unavailable,
             count(*) filter (where e.state = 'completed') as completed
      from ref.schedule_entries e
      where e.day between p_from and p_to and e.state in ('active', 'completed')
      group by e.day
    ), x as (
      select d.day, coalesce(sd.target, v_default) as target,
             coalesce(a.scheduled, 0) as scheduled, coalesce(a.confirmed, 0) as confirmed,
             coalesce(a.pending, 0) as pending, coalesce(a.unavailable, 0) as unavailable,
             coalesce(a.completed, 0) as completed
      from days d
      left join ref.schedule_days sd on sd.day = d.day
      left join agg a on a.day = d.day
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'day', day, 'target', target, 'scheduled', scheduled, 'confirmed', confirmed, 'pending', pending,
      'unavailable', unavailable, 'completed', completed,
      'remaining', greatest(target - (scheduled - unavailable), 0),
      'status', case
        when target = 0 then 'off'
        when scheduled = 0 then 'not_planned'
        when scheduled - unavailable >= target then 'planned'
        else 'incomplete' end
    ) order by day), '[]'::jsonb)
    from x
  );
end $$;

-- Small numbers for nav badges and the notification bell, in one call. Shape depends on the caller's role.
create or replace function ref.app_counts()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_role text := ref.require_role('admin', 'ops', 'referral'); v_me uuid := ref.my_referrer_id();
        v_tomorrow date := erp.today() + 1;
begin
  if v_role = 'referral' then
    return jsonb_build_object(
      'unread', (select count(*) from ref.notifications where user_id = auth.uid() and read_at is null),
      'participants', (select count(*) from ref.participants where referrer_id = v_me),
      'in_progress', (select count(*) from ref.participants where referrer_id = v_me and status not in ('completed', 'rejected')),
      'tomorrow', (select count(*) from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
                    where p.referrer_id = v_me and e.state = 'active' and e.day = v_tomorrow),
      'available', ref.available_balance(v_me)
    );
  end if;
  return jsonb_build_object(
    'unread', (select count(*) from ref.notifications where user_id = auth.uid() and read_at is null),
    'to_review', case when v_role = 'admin' then (select count(*) from ref.participants where status in ('submitted', 'under_review')) end,
    'to_schedule', case when v_role = 'admin' then (select count(*) from ref.participants where status in ('approved', 'waiting_schedule')) end,
    'tomorrow_open', (select count(*) from ref.schedule_entries where day = v_tomorrow and state = 'active'
                       and confirmation in ('not_contacted', 'contacted', 'waiting')),
    'commissions_to_verify', case when v_role = 'admin' then (select count(*) from ref.commissions where status = 'pending') end,
    'withdrawals_open', case when v_role = 'admin' then (select count(*) from ref.withdrawals where status in ('requested', 'approved')) end,
    -- the next 3 days whose effective booking is below target
    'days_short', (select count(*) from jsonb_array_elements(ref.calendar(erp.today(), erp.today() + 2)) d
                    where d ->> 'status' in ('incomplete', 'not_planned'))
  );
end $$;

-- ---------------------------------------------------------------- Phase 1: registration
create or replace function ref.submit_participant(
  p_name text, p_wa text, p_email text, p_cloud_ref text, p_avail_date date, p_avail_time time,
  p_notes text, p_consent_wa boolean, p_referrer_id uuid default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_role text := ref.require_role('admin', 'referral'); v_ref uuid; v_id uuid; v_wa text := erp.normalize_wa(p_wa);
begin
  v_ref := case when v_role = 'referral' then ref.my_referrer_id() else p_referrer_id end;
  if v_ref is null then raise exception 'Pilih referral' using errcode = '22023'; end if;
  if not coalesce(p_consent_wa, false) then
    raise exception 'Peserta harus setuju dihubungi lewat WhatsApp' using errcode = '22023';
  end if;
  if p_avail_date is not null and p_avail_date < erp.today() then
    raise exception 'Tanggal ketersediaan sudah lewat' using errcode = '22023';
  end if;
  if exists (select 1 from ref.participants where wa_norm = v_wa and status <> 'rejected') then
    raise exception 'Nomor WhatsApp ini sudah terdaftar' using errcode = '23505';
  end if;
  if exists (select 1 from ref.participants where email = lower(trim(p_email))::extensions.citext and status <> 'rejected') then
    raise exception 'Email ini sudah terdaftar' using errcode = '23505';
  end if;
  insert into ref.participants (referrer_id, name, wa, email, cloud_ref, avail_date, avail_time, notes, consent_wa)
  values (v_ref, trim(p_name), p_wa, lower(trim(p_email)), nullif(trim(p_cloud_ref), ''), p_avail_date, p_avail_time,
          nullif(trim(p_notes), ''), true)
  returning id into v_id;
  perform ref.audit('participant.submit', 'participant', v_id::text, jsonb_build_object('referrer_id', v_ref));
  perform ref.notify_referrer(v_ref, 'registration_submitted', jsonb_build_object('participant_id', v_id, 'name', trim(p_name)));
  perform ref.notify_admins('new_participant', jsonb_build_object('participant_id', v_id, 'name', trim(p_name),
          'referrer', (select name from ref.referrers where id = v_ref)));
  return v_id;
end $$;

-- A referral may still fix their own entry while it is only Submitted.
create or replace function ref.update_my_participant(
  p_id uuid, p_name text, p_wa text, p_email text, p_cloud_ref text, p_avail_date date, p_avail_time time, p_notes text
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_role text := ref.require_role('admin', 'referral');
begin
  update ref.participants
     set name = trim(p_name), wa = p_wa, email = lower(trim(p_email)), cloud_ref = nullif(trim(p_cloud_ref), ''),
         avail_date = p_avail_date, avail_time = p_avail_time, notes = nullif(trim(p_notes), '')
   where id = p_id
     and (v_role = 'admin' or (referrer_id = ref.my_referrer_id() and status = 'submitted'));
  if not found then raise exception 'Data tidak bisa diubah lagi' using errcode = '42501'; end if;
  perform ref.audit('participant.edit', 'participant', p_id::text);
end $$;

-- review: Submitted -> Under Review. approve: -> Approved. reject: -> Rejected (with a reason the referral sees).
create or replace function ref.review_participants(p_ids uuid[], p_action text, p_reason text default null)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_p ref.participants; n int := 0; v_to ref.participant_status;
begin
  perform ref.require_role('admin');
  v_to := case p_action when 'review' then 'under_review' when 'approve' then 'approved' when 'reject' then 'rejected' end;
  if v_to is null then raise exception 'Aksi tidak dikenal' using errcode = '22023'; end if;
  if v_to = 'rejected' and coalesce(trim(p_reason), '') = '' then
    raise exception 'Isi alasan penolakan' using errcode = '22023';
  end if;
  for v_p in select * from ref.participants where id = any (p_ids) for update loop
    if v_p.status not in ('submitted', 'under_review') and not (v_to = 'rejected' and v_p.status in ('approved', 'waiting_schedule')) then
      continue;
    end if;
    update ref.participants set status = v_to, reject_reason = case when v_to = 'rejected' then trim(p_reason) end
     where id = v_p.id;
    n := n + 1;
    if v_to <> 'under_review' then
      perform ref.notify_referrer(v_p.referrer_id,
        case when v_to = 'approved' then 'registration_approved' else 'registration_rejected' end,
        jsonb_build_object('participant_id', v_p.id, 'name', v_p.name, 'reason', p_reason));
    end if;
  end loop;
  perform ref.audit('participant.' || p_action, 'participant', null, jsonb_build_object('ids', p_ids, 'n', n, 'reason', p_reason));
  return n;
end $$;

create or replace function ref.add_ops_note(p_participant_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin', 'ops');
  insert into ref.ops_notes (participant_id, note) values (p_participant_id, trim(p_note));
  insert into ref.participant_events (participant_id, kind) values (p_participant_id, 'note');
end $$;

-- ---------------------------------------------------------------- Phase 2: scheduling
create or replace function ref.set_day_target(p_day date, p_target int, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin');
  insert into ref.schedule_days (day, target, note) values (p_day, p_target, p_note)
  on conflict (day) do update set target = excluded.target, note = excluded.note, updated_at = now(), updated_by = auth.uid();
  perform ref.audit('day.target', 'day', p_day::text, jsonb_build_object('target', p_target));
end $$;

-- Put participants on a day (or move them there). A participant who already holds a place elsewhere is moved:
-- the old entry becomes 'moved' and points to the new one. Refuses to go over the day's target unless p_allow_over.
create or replace function ref.schedule_participants(p_day date, p_ids uuid[], p_time time default null, p_allow_over boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_p ref.participants; v_old ref.schedule_entries; v_new uuid; v_target int; v_used int;
  n_new int := 0; n_moved int := 0;
begin
  perform ref.require_role('admin');
  if p_day < erp.today() then raise exception 'Tanggal sudah lewat' using errcode = '22023'; end if;

  -- lock the day so two admins cannot overfill it at the same time
  insert into ref.schedule_days (day, target) values (p_day, coalesce(ref.setting_int('daily_target'), 20))
  on conflict (day) do nothing;
  select target into v_target from ref.schedule_days where day = p_day for update;

  for v_p in select * from ref.participants where id = any (p_ids) order by created_at for update loop
    if v_p.status not in ('approved', 'waiting_schedule', 'scheduled', 'confirmation_pending', 'confirmed') then
      raise exception 'Peserta % belum disetujui atau sudah selesai', v_p.name using errcode = '22023';
    end if;
    select * into v_old from ref.schedule_entries where participant_id = v_p.id and state = 'active';
    if found and v_old.day = p_day then
      update ref.schedule_entries set start_time = coalesce(p_time, start_time) where id = v_old.id;
      continue;
    end if;
    if found then
      update ref.schedule_entries set state = 'moved' where id = v_old.id;
    end if;
    insert into ref.schedule_entries (participant_id, day, start_time)
    values (v_p.id, p_day, coalesce(p_time, v_p.avail_time))
    returning id into v_new;
    if v_old.id is not null then
      update ref.schedule_entries set moved_to = v_new where id = v_old.id;
      n_moved := n_moved + 1;
    else
      n_new := n_new + 1;
    end if;
    update ref.participants set status = 'scheduled' where id = v_p.id;
    insert into ref.participant_events (participant_id, kind, from_value, to_value, detail)
    values (v_p.id, 'schedule', v_old.day::text, p_day::text, jsonb_build_object('time', coalesce(p_time, v_p.avail_time)));
    perform ref.notify_referrer(v_p.referrer_id,
      case when v_old.id is null then 'schedule_assigned' else 'schedule_changed' end,
      jsonb_build_object('participant_id', v_p.id, 'name', v_p.name, 'day', p_day, 'time', coalesce(p_time, v_p.avail_time),
                         'from_day', v_old.day));
    v_old := null;
  end loop;

  select count(*) - count(*) filter (where state = 'active' and confirmation in ('unavailable', 'reschedule'))
    into v_used from ref.schedule_entries where day = p_day and state in ('active', 'completed');
  if v_used > v_target and not p_allow_over then
    raise exception 'Kapasitas % penuh: target %, terisi % (lebihi target hanya jika disengaja)', p_day, v_target, v_used
      using errcode = '23514';
  end if;
  perform ref.audit('schedule.assign', 'day', p_day::text, jsonb_build_object('ids', p_ids, 'new', n_new, 'moved', n_moved));
  return jsonb_build_object('new', n_new, 'moved', n_moved, 'target', v_target, 'used', v_used);
end $$;

-- Take a place off the schedule; the participant goes back to Waiting for Schedule.
create or replace function ref.unschedule(p_entry_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_e ref.schedule_entries;
begin
  perform ref.require_role('admin');
  update ref.schedule_entries set state = 'cancelled' where id = p_entry_id and state = 'active' returning * into v_e;
  if not found then raise exception 'Jadwal tidak ditemukan' using errcode = 'P0002'; end if;
  update ref.participants set status = 'waiting_schedule' where id = v_e.participant_id;
  insert into ref.participant_events (participant_id, kind, from_value, to_value) values (v_e.participant_id, 'schedule', v_e.day::text, null);
  perform ref.notify_referrer((select referrer_id from ref.participants where id = v_e.participant_id), 'schedule_changed',
    jsonb_build_object('participant_id', v_e.participant_id, 'from_day', v_e.day, 'day', null));
  perform ref.audit('schedule.cancel', 'entry', p_entry_id::text);
end $$;

-- H-1 confirmation result. Moves the participant status along:
--   contacted / waiting -> Confirmation Pending, available -> Confirmed,
--   unavailable / reschedule -> Waiting for Schedule (the place stays visible as unavailable until it is moved),
--   not_contacted -> Scheduled.
create or replace function ref.set_confirmation(p_entry_id uuid, p_status ref.confirmation_status, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_e ref.schedule_entries;
begin
  perform ref.require_role('admin', 'ops');
  select * into v_e from ref.schedule_entries where id = p_entry_id and state = 'active' for update;
  if not found then raise exception 'Jadwal tidak ditemukan' using errcode = 'P0002'; end if;
  update ref.schedule_entries
     set confirmation = p_status, confirmation_at = now(), confirmation_by = auth.uid()
   where id = p_entry_id;
  update ref.participants set status = case
      when p_status in ('contacted', 'waiting') then 'confirmation_pending'
      when p_status = 'available' then 'confirmed'
      when p_status in ('unavailable', 'reschedule') then 'waiting_schedule'
      else 'scheduled' end::ref.participant_status
   where id = v_e.participant_id;
  insert into ref.participant_events (participant_id, kind, from_value, to_value)
  values (v_e.participant_id, 'confirmation', v_e.confirmation::text, p_status::text);
  if coalesce(trim(p_note), '') <> '' then
    insert into ref.ops_notes (participant_id, note) values (v_e.participant_id, trim(p_note));
  end if;
  if p_status in ('unavailable', 'reschedule') then
    perform ref.notify_admins('participant_unavailable', jsonb_build_object('participant_id', v_e.participant_id, 'day', v_e.day,
            'name', (select name from ref.participants where id = v_e.participant_id)));
  end if;
  perform ref.audit('confirmation.set', 'entry', p_entry_id::text, jsonb_build_object('status', p_status));
end $$;

-- The work for this place is done (on or after its day). Creates the commission as Pending; an admin verifies it.
create or replace function ref.complete_entry(p_entry_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_e ref.schedule_entries; v_p ref.participants;
begin
  perform ref.require_role('admin', 'ops');
  select * into v_e from ref.schedule_entries where id = p_entry_id and state = 'active' for update;
  if not found then raise exception 'Jadwal tidak ditemukan' using errcode = 'P0002'; end if;
  if v_e.day > erp.today() then raise exception 'Belum bisa diselesaikan sebelum tanggal jadwalnya' using errcode = '22023'; end if;
  select * into v_p from ref.participants where id = v_e.participant_id for update;
  update ref.schedule_entries set state = 'completed', completed_at = now(),
         confirmation = case when confirmation in ('unavailable', 'reschedule') then confirmation else 'available' end
   where id = p_entry_id;
  update ref.participants set status = 'completed' where id = v_p.id;
  insert into ref.commissions (referrer_id, participant_id, amount)
  values (v_p.referrer_id, v_p.id, coalesce(ref.setting_int('commission_per_completed'), 0))
  on conflict do nothing;
  if coalesce(trim(p_note), '') <> '' then
    insert into ref.ops_notes (participant_id, note) values (v_p.id, trim(p_note));
  end if;
  perform ref.audit('entry.complete', 'entry', p_entry_id::text, jsonb_build_object('participant_id', v_p.id));
end $$;

-- ---------------------------------------------------------------- Phase 3: commissions and withdrawals
create or replace function ref.set_commission_amount(p_id uuid, p_amount bigint)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin');
  if p_amount < 0 then raise exception 'Nominal tidak valid' using errcode = '22023'; end if;
  update ref.commissions set amount = p_amount where id = p_id and status = 'pending';
  if not found then raise exception 'Hanya komisi Pending yang bisa diubah' using errcode = '22023'; end if;
  perform ref.audit('commission.amount', 'commission', p_id::text, jsonb_build_object('amount', p_amount));
end $$;

-- Verify: Pending -> Approved (counts toward the balance) or Void. Approved commissions cannot be voided here,
-- so a balance that may already be on hold or paid out can never shrink below zero.
create or replace function ref.verify_commissions(p_ids uuid[], p_approve boolean)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_c ref.commissions; n int := 0;
begin
  perform ref.require_role('admin');
  for v_c in update ref.commissions
                set status = case when p_approve then 'approved' else 'void' end::ref.commission_status,
                    decided_at = now(), decided_by = auth.uid()
              where id = any (p_ids) and status = 'pending'
          returning * loop
    n := n + 1;
    if p_approve then
      perform ref.notify_referrer(v_c.referrer_id, 'commission_approved',
        jsonb_build_object('commission_id', v_c.id, 'amount', v_c.amount,
                           'name', (select name from ref.participants where id = v_c.participant_id)));
    end if;
  end loop;
  perform ref.audit(case when p_approve then 'commission.approve' else 'commission.void' end, 'commission', null,
                    jsonb_build_object('ids', p_ids, 'n', n));
  return n;
end $$;

create or replace function ref.update_my_payout(p_method text, p_account text, p_name text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('referral');
  if coalesce(trim(p_method), '') = '' or coalesce(trim(p_account), '') = '' or coalesce(trim(p_name), '') = '' then
    raise exception 'Lengkapi bank/e-wallet, nomor, dan nama pemilik' using errcode = '22023';
  end if;
  update ref.referrers set payout_method = trim(p_method), payout_account = trim(p_account), payout_name = trim(p_name)
   where id = ref.my_referrer_id();
  perform ref.audit('referrer.payout', 'referrer', ref.my_referrer_id()::text);
end $$;

-- The referrer row is locked while the balance is checked, so two requests at once cannot both pass.
create or replace function ref.request_withdrawal(p_amount bigint)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_r ref.referrers; v_avail bigint; v_id uuid;
begin
  perform ref.require_role('referral');
  select * into v_r from ref.referrers where id = ref.my_referrer_id() for update;
  if v_r.payout_account is null then raise exception 'Isi rekening pencairan dulu' using errcode = '22023'; end if;
  if p_amount is null or p_amount < coalesce(ref.setting_int('withdraw_min'), 1) then
    raise exception 'Minimal pencairan Rp %', coalesce(ref.setting_int('withdraw_min'), 1) using errcode = '22023';
  end if;
  v_avail := ref.available_balance(v_r.id);
  if p_amount > v_avail then
    raise exception 'Saldo tersedia hanya Rp %', v_avail using errcode = '22023';
  end if;
  insert into ref.withdrawals (referrer_id, amount, payout_method, payout_account, payout_name)
  values (v_r.id, p_amount, v_r.payout_method, v_r.payout_account, v_r.payout_name)
  returning id into v_id;
  perform ref.audit('withdrawal.request', 'withdrawal', v_id::text, jsonb_build_object('amount', p_amount));
  perform ref.notify_admins('withdrawal_requested', jsonb_build_object('withdrawal_id', v_id, 'amount', p_amount, 'referrer', v_r.name));
  return v_id;
end $$;

create or replace function ref.cancel_my_withdrawal(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('referral');
  update ref.withdrawals set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where id = p_id and referrer_id = ref.my_referrer_id() and status = 'requested';
  if not found then raise exception 'Permintaan tidak bisa dibatalkan' using errcode = '22023'; end if;
  perform ref.audit('withdrawal.cancel', 'withdrawal', p_id::text);
end $$;

-- approve: Requested -> Approved. reject: Requested/Approved -> Rejected (the hold is released).
create or replace function ref.decide_withdrawal(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_w ref.withdrawals;
begin
  perform ref.require_role('admin');
  update ref.withdrawals
     set status = case when p_approve then 'approved' else 'rejected' end::ref.withdrawal_status,
         decided_at = now(), decided_by = auth.uid(), decision_note = nullif(trim(p_note), '')
   where id = p_id and (status = 'requested' or (not p_approve and status = 'approved'))
  returning * into v_w;
  if not found then raise exception 'Status permintaan sudah berubah' using errcode = '22023'; end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then
    raise exception 'Isi alasan penolakan' using errcode = '22023';
  end if;
  perform ref.notify_referrer(v_w.referrer_id, case when p_approve then 'withdrawal_approved' else 'withdrawal_rejected' end,
    jsonb_build_object('withdrawal_id', v_w.id, 'amount', v_w.amount, 'note', p_note));
  perform ref.audit(case when p_approve then 'withdrawal.approve' else 'withdrawal.reject' end, 'withdrawal', p_id::text);
end $$;

-- Only after the money was actually sent. Needs a transfer reference or an uploaded proof.
create or replace function ref.mark_withdrawal_paid(p_id uuid, p_reference text, p_proof_path text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_w ref.withdrawals;
begin
  perform ref.require_role('admin');
  if coalesce(trim(p_reference), '') = '' and coalesce(trim(p_proof_path), '') = '' then
    raise exception 'Isi nomor referensi transfer atau unggah bukti' using errcode = '22023';
  end if;
  update ref.withdrawals
     set status = 'paid', paid_at = now(), paid_by = auth.uid(),
         payment_reference = nullif(trim(p_reference), ''), proof_path = nullif(trim(p_proof_path), '')
   where id = p_id and status = 'approved'
  returning * into v_w;
  if not found then raise exception 'Hanya permintaan yang sudah disetujui yang bisa ditandai dibayar' using errcode = '22023'; end if;
  perform ref.notify_referrer(v_w.referrer_id, 'payment_completed', jsonb_build_object('withdrawal_id', v_w.id, 'amount', v_w.amount));
  perform ref.audit('withdrawal.paid', 'withdrawal', p_id::text, jsonb_build_object('reference', p_reference, 'proof', p_proof_path));
end $$;

-- ---------------------------------------------------------------- integration with the ERP
create or replace function ref.link_erp_account(p_participant_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin');
  update ref.participants set erp_account_id = p_account_id where id = p_participant_id;
  perform ref.audit('participant.link_erp', 'participant', p_participant_id::text, jsonb_build_object('account_id', p_account_id));
end $$;

-- Admin creates a referral. The login itself is made in Supabase Auth (invite by email) first; this links it.
create or replace function ref.create_referrer(p_name text, p_wa text, p_email text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_user uuid; v_id uuid;
begin
  perform ref.require_role('admin');
  if p_email is not null then
    select id into v_user from auth.users where lower(email) = lower(trim(p_email));
    if v_user is null then raise exception 'Login % belum dibuat di Supabase Auth', p_email using errcode = 'P0002'; end if;
    if exists (select 1 from erp.profiles where user_id = v_user) then
      raise exception 'Login ini milik tim ERP, tidak bisa dijadikan referral' using errcode = '22023';
    end if;
  end if;
  insert into ref.referrers (user_id, name, wa) values (v_user, trim(p_name), p_wa) returning id into v_id;
  perform ref.audit('referrer.create', 'referrer', v_id::text);
  return v_id;
end $$;

create or replace function ref.mark_notifications_read(p_ids bigint[] default null)
returns int language plpgsql security definer set search_path = ''
as $$
declare n int;
begin
  update ref.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- Phase 4: reports
create or replace function ref.referrer_performance(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin');
  return (
    select coalesce(jsonb_agg(row_to_json(x) order by x.completed desc, x.participants desc, x.name), '[]'::jsonb)
    from (
      select r.id, r.name,
             count(p.id) as participants,
             count(p.id) filter (where p.status = 'completed') as completed,
             count(p.id) filter (where p.status = 'rejected') as rejected,
             case when count(p.id) = 0 then 0
                  else round(100.0 * count(p.id) filter (where p.status = 'completed') / count(p.id), 1) end as conversion_pct,
             coalesce((select sum(c.amount) from ref.commissions c join ref.participants pp on pp.id = c.participant_id
                        where c.referrer_id = r.id and c.status <> 'void' and pp.entered_on between p_from and p_to), 0) as commission,
             coalesce((select sum(w.amount) from ref.withdrawals w
                        where w.referrer_id = r.id and w.status = 'paid'
                          and (w.paid_at at time zone 'Asia/Jakarta')::date between p_from and p_to), 0) as paid
      from ref.referrers r
      left join ref.participants p on p.referrer_id = r.id and p.entered_on between p_from and p_to
      group by r.id, r.name
    ) x
  );
end $$;

-- p_bucket: day | week | month
create or replace function ref.ops_performance(p_from date, p_to date, p_bucket text default 'day')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin');
  if p_bucket not in ('day', 'week', 'month') then raise exception 'Bucket tidak dikenal' using errcode = '22023'; end if;
  return (
    with cal as (
      select (d ->> 'day')::date as day, (d ->> 'target')::int as target, (d ->> 'completed')::int as completed,
             (d ->> 'scheduled')::int as scheduled
      from jsonb_array_elements(ref.calendar(p_from, p_to)) d
    ), conf as (
      select e.day,
             count(*) filter (where e.confirmation = 'available') as yes,
             count(*) filter (where e.confirmation in ('available', 'unavailable', 'reschedule')) as answered
      from ref.schedule_entries e
      where e.day between p_from and p_to and e.state in ('active', 'completed')
      group by e.day
    ), moved as (
      select e.day, count(*) as n from ref.schedule_entries e
      where e.day between p_from and p_to and e.state = 'moved' group by e.day
    ), b as (
      select date_trunc(p_bucket, cal.day::timestamp)::date as bucket,
             sum(target) as target, sum(scheduled) as scheduled, sum(cal.completed) as completed,
             sum(coalesce(conf.yes, 0)) as yes, sum(coalesce(conf.answered, 0)) as answered,
             sum(coalesce(moved.n, 0)) as rescheduled
      from cal left join conf using (day) left join moved using (day)
      group by 1
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'target', target, 'scheduled', scheduled, 'completed', completed,
      'achievement_pct', case when target = 0 then null else round(100.0 * completed / target, 1) end,
      'confirmation_pct', case when answered = 0 then null else round(100.0 * yes / answered, 1) end,
      'rescheduled', rescheduled
    ) order by bucket), '[]'::jsonb)
    from b
  );
end $$;

-- ---------------------------------------------------------------- RLS (read only; writes go through the functions)
-- Owner of a participant, read without RLS, so the policies below do not call each other in a loop.
create or replace function ref.participant_referrer(p_participant_id uuid)
returns uuid language sql stable security definer set search_path = ''
as $$ select referrer_id from ref.participants where id = p_participant_id $$;

alter table ref.settings enable row level security;
alter table ref.referrers enable row level security;
alter table ref.participants enable row level security;
alter table ref.participant_events enable row level security;
alter table ref.ops_notes enable row level security;
alter table ref.schedule_days enable row level security;
alter table ref.schedule_entries enable row level security;
alter table ref.commissions enable row level security;
alter table ref.withdrawals enable row level security;
alter table ref.notifications enable row level security;
alter table ref.audit_log enable row level security;

create policy read_all on ref.settings for select to authenticated using ((select ref.my_role()) is not null);
create policy admin_update on ref.settings for update to authenticated
  using ((select ref.my_role()) = 'admin') with check ((select ref.my_role()) = 'admin');

create policy read_scoped on ref.referrers for select to authenticated
  using ((select ref.my_role()) in ('admin', 'ops') or id = (select ref.my_referrer_id()));

-- ops see participants who are (or were) on the schedule; a referral sees their own.
create policy read_scoped on ref.participants for select to authenticated
  using ((select ref.my_role()) = 'admin'
         or referrer_id = (select ref.my_referrer_id())
         or ((select ref.my_role()) = 'ops' and exists (select 1 from ref.schedule_entries e where e.participant_id = participants.id)));

create policy read_scoped on ref.participant_events for select to authenticated
  using ((select ref.my_role()) in ('admin', 'ops')
         or (kind in ('status', 'schedule')
             and ref.participant_referrer(participant_id) = (select ref.my_referrer_id())));

create policy read_team on ref.ops_notes for select to authenticated using ((select ref.my_role()) in ('admin', 'ops'));
create policy read_team on ref.schedule_days for select to authenticated using ((select ref.my_role()) in ('admin', 'ops'));

create policy read_scoped on ref.schedule_entries for select to authenticated
  using ((select ref.my_role()) in ('admin', 'ops')
         or ref.participant_referrer(participant_id) = (select ref.my_referrer_id()));

create policy read_scoped on ref.commissions for select to authenticated
  using ((select ref.my_role()) = 'admin' or referrer_id = (select ref.my_referrer_id()));
create policy read_scoped on ref.withdrawals for select to authenticated
  using ((select ref.my_role()) = 'admin' or referrer_id = (select ref.my_referrer_id()));

create policy read_own on ref.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy read_admin on ref.audit_log for select to authenticated using ((select ref.my_role()) = 'admin');

-- ---------------------------------------------------------------- grants
revoke all on schema ref from anon, public;
grant usage on schema ref to authenticated;
grant select on all tables in schema ref to authenticated;
grant update on ref.settings to authenticated;
revoke execute on all functions in schema ref from anon, public;
grant execute on all functions in schema ref to authenticated;
-- internal helpers: callable only from inside the functions above
revoke execute on function ref.audit(text, text, text, jsonb) from authenticated;
revoke execute on function ref.notify_referrer(uuid, text, jsonb) from authenticated;
revoke execute on function ref.notify_admins(text, jsonb) from authenticated;
revoke execute on function ref.participants_track() from authenticated;

-- ---------------------------------------------------------------- storage: payment proofs (private bucket)
-- Path: <referrer_id>/<withdrawal_id>.<ext>. Admin uploads and reads; a referral reads files in their own folder.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('ref-payment-proofs', 'ref-payment-proofs', false)
    on conflict (id) do nothing;
    execute $p$create policy ref_proofs_admin_write on storage.objects for insert to authenticated
      with check (bucket_id = 'ref-payment-proofs' and (select ref.my_role()) = 'admin')$p$;
    execute $p$create policy ref_proofs_read on storage.objects for select to authenticated
      using (bucket_id = 'ref-payment-proofs' and ((select ref.my_role()) = 'admin'
             or (storage.foldername(name))[1] = (select ref.my_referrer_id())::text))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------- expose `ref` to the Data API (PostgREST)
do $$
declare cur text;
begin
  select coalesce(
    (select substring(c from '^pgrst\.db_schemas=(.*)$')
       from pg_db_role_setting rs
       join pg_roles r on r.oid = rs.setrole and r.rolname = 'authenticator',
       unnest(rs.setconfig) c
      where c like 'pgrst.db_schemas=%'),
    'public, graphql_public') into cur;
  if not 'ref' = any (string_to_array(replace(cur, ' ', ''), ',')) then
    execute format('alter role authenticator set pgrst.db_schemas = %L', cur || ', ref');
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
