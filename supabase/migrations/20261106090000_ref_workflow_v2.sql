-- Workflow v2 (docs/WORKFLOW-V2.md): H-1 through the referral, confirmation by the referral in the portal,
-- commission rate per referral (default Rp75.000), "can do on which weekdays", the participant's account password in
-- Vault, a 21.00 confirmation deadline, editable settings.
-- STATUS: applied to the Supabase project vfttmslrjimbndseqqko on 2026-11-05 (owner agreed). It renamed two RPC
-- signatures (submit_participant, update_my_participant), so the portal and ERP builds of the same change go with it.
--
-- Every new function: security definer, search_path empty, role checked first, EXECUTE revoked from public/anon
-- (anon has schema usage since the sign-up migration, so a default PUBLIC grant would expose it).

-- ---------------------------------------------------------------- columns and settings
alter table ref.participants add column avail_days smallint[]
  check (avail_days is null or (cardinality(avail_days) between 1 and 6 and avail_days <@ array[1,2,3,4,5,6,7]::smallint[]));
comment on column ref.participants.avail_days is 'ISO weekdays the participant can do (1 = Monday ... 7 = Sunday). NULL = any day. Re-checked at H-1.';
-- Only a flag lives here. The password itself is in Vault, linked through ref.participant_secrets.
alter table ref.participants add column has_password boolean not null default false;
alter table ref.referrers add column commission_rate bigint check (commission_rate is null or commission_rate between 0 and 10000000);
comment on column ref.referrers.commission_rate is 'Commission per completed number for this referral. NULL = the default in settings.';

-- participant -> Vault secret. No grants and no policies: only the SECURITY DEFINER functions below touch it.
create table ref.participant_secrets (
  participant_id uuid primary key references ref.participants (id) on delete cascade,
  secret_id uuid not null
);
alter table ref.participant_secrets enable row level security;
revoke all on ref.participant_secrets from public, anon, authenticated;

update ref.settings set value = '75000', updated_at = now() where key = 'commission_per_completed';
insert into ref.settings (key, value) values
  ('confirm_deadline', '"21:00"'),
  ('portal_url', '"https://referral.tampilresmi.com"'),
  ('wa_referral_h1_template', to_jsonb(E'Halo {referral}, besok {date} ada {count} nomor kamu yang dijadwalkan:\n{list}\nTolong kabari pemilik nomornya dan siapkan ya. Tandai yang siap atau tidak bisa paling lambat jam {deadline} di sini:\n{link}\nTerima kasih!'::text))
on conflict (key) do nothing;

-- ---------------------------------------------------------------- settings: one validated function instead of direct updates
drop policy if exists admin_update on ref.settings;
revoke update on ref.settings from authenticated;

create or replace function ref.set_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_old jsonb; v_new jsonb := p_value; v_txt text; v_n numeric; v_min numeric; v_max numeric;
begin
  perform ref.require_role('admin');
  select value into v_old from ref.settings where key = p_key;
  if p_key not in ('commission_per_completed', 'wa_referral_h1_template', 'wa_confirm_template', 'confirm_deadline',
                   'daily_target', 'withdraw_min', 'withdraw_presets', 'admin_wa', 'payout_hours') then
    raise exception 'Pengaturan "%" tidak bisa diubah di sini', p_key using errcode = '22023';
  end if;
  if p_key in ('commission_per_completed', 'daily_target', 'withdraw_min', 'payout_hours') then
    if jsonb_typeof(p_value) <> 'number' then raise exception 'Isi angka' using errcode = '22023'; end if;
    v_n := (p_value #>> '{}')::numeric;
    v_max := case p_key when 'daily_target' then 500 when 'payout_hours' then 240 else 10000000 end;   -- (not inside IF: plpgsql stops at the first THEN)
    v_min := case p_key when 'payout_hours' then 1 else 0 end;
    if v_n <> trunc(v_n) or v_n < v_min or v_n > v_max then
      raise exception 'Angka di luar batas untuk %', p_key using errcode = '22023';
    end if;
  elsif p_key in ('wa_referral_h1_template', 'wa_confirm_template') then
    if jsonb_typeof(p_value) <> 'string' or length(trim(p_value #>> '{}')) not between 10 and 1500 then
      raise exception 'Template pesan 10 sampai 1500 karakter' using errcode = '22023';
    end if;
  elsif p_key = 'confirm_deadline' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Jam batas konfirmasi harus berbentuk HH:MM, misalnya 21:00' using errcode = '22023';
    end if;
  elsif p_key = 'withdraw_presets' then
    if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) not between 1 and 8
       or exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'number' or (e #>> '{}')::numeric <= 0 or (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric)) then
      raise exception 'Isi 1 sampai 8 nominal bulat' using errcode = '22023';
    end if;
  elsif p_key = 'admin_wa' then
    v_txt := erp.normalize_wa(p_value #>> '{}');
    if jsonb_typeof(p_value) <> 'string' or length(coalesce(v_txt, '')) not between 10 and 15 then
      raise exception 'Nomor WhatsApp admin belum benar' using errcode = '22023';
    end if;
    v_new := to_jsonb(v_txt);
  end if;
  update ref.settings set value = v_new, updated_at = now() where key = p_key;
  if not found then insert into ref.settings (key, value) values (p_key, v_new); end if;
  perform ref.audit('setting.set', 'setting', p_key, jsonb_build_object('old', v_old, 'new', v_new));
end $$;

-- ---------------------------------------------------------------- helpers
-- True when the referral can no longer confirm that day: today or earlier, or tomorrow after the deadline (WIB).
create or replace function ref.confirm_closed(p_day date)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_day <= erp.today()
      or (p_day = erp.today() + 1
          and (now() at time zone 'Asia/Jakarta')::time >= coalesce((select (value #>> '{}')::time from ref.settings where key = 'confirm_deadline'), time '21:00'))
$$;

-- Name of whoever answered (team member or referral). Team only; a referral gets null.
create or replace function ref.actor_name(p_user uuid)
returns text language sql stable security definer set search_path = ''
as $$
  select case when ref.my_role() in ('admin', 'ops') then
    coalesce((select display_name from erp.profiles where user_id = p_user), (select name from ref.referrers where user_id = p_user))
  end
$$;

-- The one place where an answer changes a schedule entry and the participant status (same rules as before).
create or replace function ref._apply_confirmation(p_entry_id uuid, p_status ref.confirmation_status, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_e ref.schedule_entries;
begin
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
end $$;

create or replace function ref.set_confirmation(p_entry_id uuid, p_status ref.confirmation_status, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin', 'ops');
  perform ref._apply_confirmation(p_entry_id, p_status, p_note);
  perform ref.audit('confirmation.set', 'entry', p_entry_id::text, jsonb_build_object('status', p_status));
end $$;

-- The numbers the public "Cara mulai" page quotes (before login). Only these, nothing else from settings.
create or replace function ref.public_info()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'commission', coalesce((select (value #>> '{}')::bigint from ref.settings where key = 'commission_per_completed'), 75000),
    'withdraw_min', coalesce((select (value #>> '{}')::bigint from ref.settings where key = 'withdraw_min'), 50000),
    'payout_hours', coalesce((select (value #>> '{}')::int from ref.settings where key = 'payout_hours'), 24),
    'confirm_deadline', coalesce((select value #>> '{}' from ref.settings where key = 'confirm_deadline'), '21:00'),
    'admin_wa', coalesce((select value #>> '{}' from ref.settings where key = 'admin_wa'), '6281299323591')
  )
$$;

-- ---------------------------------------------------------------- H-1 through the referral
-- The team opened the WhatsApp chat to a referral: their unanswered numbers for that day become "contacted".
create or replace function ref.mark_referrer_contacted(p_day date, p_referrer_id uuid)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; n int := 0;
begin
  perform ref.require_role('admin', 'ops');
  for v_id in
    select e.id from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
     where e.day = p_day and e.state = 'active' and p.referrer_id = p_referrer_id and e.confirmation = 'not_contacted'
     order by e.id
  loop
    perform ref._apply_confirmation(v_id, 'contacted');
    n := n + 1;
  end loop;
  perform ref.audit('confirmation.contacted', 'referrer', p_referrer_id::text, jsonb_build_object('day', p_day, 'n', n));
  return n;
end $$;

-- "All ready" (or any status) for a referral's numbers that have no real answer yet. Answers the referral already
-- gave (ready or not ready) are never overwritten here.
create or replace function ref.bulk_confirm(p_day date, p_referrer_id uuid, p_status ref.confirmation_status)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; n int := 0;
begin
  perform ref.require_role('admin', 'ops');
  if p_status = 'not_contacted' then raise exception 'Status tidak valid' using errcode = '22023'; end if;
  for v_id in
    select e.id from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
     where e.day = p_day and e.state = 'active' and p.referrer_id = p_referrer_id
       and e.confirmation in ('not_contacted', 'contacted', 'waiting')
     order by e.id
  loop
    perform ref._apply_confirmation(v_id, p_status);
    n := n + 1;
  end loop;
  perform ref.audit('confirmation.bulk', 'referrer', p_referrer_id::text, jsonb_build_object('day', p_day, 'status', p_status, 'n', n));
  return n;
end $$;

-- The referral answers for their own numbers (ids = schedule entry ids). Allowed until the deadline of the day before.
create or replace function ref.confirm_my_day(p_day date, p_ready uuid[], p_not_ready uuid[], p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_me uuid; v_ready uuid[] := coalesce(p_ready, '{}'); v_not uuid[] := coalesce(p_not_ready, '{}'); v_all uuid[]; v_id uuid;
        v_deadline text; v_name text; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform ref.require_role('referral');
  v_me := ref.my_referrer_id();
  if ref.confirm_closed(p_day) then
    v_deadline := coalesce((select value #>> '{}' from ref.settings where key = 'confirm_deadline'), '21:00');
    raise exception 'Batas konfirmasi jam % sudah lewat. Chat admin kalau ada perubahan.', replace(v_deadline, ':', '.') using errcode = '22023';
  end if;
  v_all := v_ready || v_not;
  if cardinality(v_all) = 0 then raise exception 'Pilih nomor yang mau dikonfirmasi' using errcode = '22023'; end if;
  if cardinality(v_all) <> (select count(distinct x) from unnest(v_all) x) then
    raise exception 'Satu nomor tidak boleh ada di dua pilihan' using errcode = '22023';
  end if;
  -- every id must be an active place of this referral on that day; anything else is refused, not skipped
  if (select count(*) from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
       where e.id = any (v_all) and e.state = 'active' and e.day = p_day and p.referrer_id = v_me) <> cardinality(v_all) then
    raise exception 'Ada nomor yang bukan milik Anda atau sudah tidak dijadwalkan' using errcode = '42501';
  end if;
  foreach v_id in array v_ready loop
    perform ref._apply_confirmation(v_id, 'available', case when v_note is null then null else 'Dari referral: ' || v_note end);
  end loop;
  foreach v_id in array v_not loop
    perform ref._apply_confirmation(v_id, 'unavailable', case when v_note is null then null else 'Dari referral: ' || v_note end);
  end loop;
  select name into v_name from ref.referrers where id = v_me;
  perform ref.notify_admins('referral_confirmed', jsonb_build_object('referrer_id', v_me, 'referrer', v_name, 'day', p_day,
          'ready', cardinality(v_ready), 'not_ready', cardinality(v_not)));
  perform ref.audit('confirmation.referral', 'referrer', v_me::text, jsonb_build_object('day', p_day, 'ready', v_ready, 'not_ready', v_not));
  return jsonb_build_object('ready', cardinality(v_ready), 'not_ready', cardinality(v_not));
end $$;

-- "All done" for a list of entries (all or nothing: the first entry that cannot be completed stops the batch).
create or replace function ref.complete_entries(p_ids uuid[], p_note text default null)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; n int := 0;
begin
  perform ref.require_role('admin', 'ops');
  foreach v_id in array coalesce(p_ids, '{}') loop
    perform ref.complete_entry(v_id, p_note);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- commission per referral
-- Rate used for a referral right now.
create or replace function ref.effective_rate(p_referrer_id uuid)
returns bigint language sql stable security definer set search_path = ''
as $$
  select coalesce((select commission_rate from ref.referrers where id = p_referrer_id),
                  (select (value #>> '{}')::bigint from ref.settings where key = 'commission_per_completed'), 0)
$$;

create or replace function ref.set_referrer_rate(p_referrer_id uuid, p_rate bigint, p_apply_pending boolean default false)
returns int language plpgsql security definer set search_path = ''
as $$
declare v_old bigint; v_n int := 0; v_eff bigint;
begin
  perform ref.require_role('admin');
  if p_rate is not null and p_rate not between 0 and 10000000 then raise exception 'Nominal tidak valid' using errcode = '22023'; end if;
  select commission_rate into v_old from ref.referrers where id = p_referrer_id for update;
  if not found then raise exception 'Referral tidak ditemukan' using errcode = 'P0002'; end if;
  update ref.referrers set commission_rate = p_rate where id = p_referrer_id;
  v_eff := ref.effective_rate(p_referrer_id);
  if p_apply_pending then
    update ref.commissions set amount = v_eff where referrer_id = p_referrer_id and status = 'pending' and amount <> v_eff;
    get diagnostics v_n = row_count;
  end if;
  perform ref.audit('referrer.rate', 'referrer', p_referrer_id::text,
                    jsonb_build_object('old', v_old, 'new', p_rate, 'apply_pending', p_apply_pending, 'changed', v_n));
  if v_old is distinct from p_rate then
    perform ref.notify_referrer(p_referrer_id, 'rate_changed', jsonb_build_object('rate', v_eff));
  end if;
  return v_n;
end $$;

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
  values (v_p.referrer_id, v_p.id, ref.effective_rate(v_p.referrer_id))
  on conflict do nothing;
  if coalesce(trim(p_note), '') <> '' then
    insert into ref.ops_notes (participant_id, note) values (v_p.id, trim(p_note));
  end if;
  perform ref.audit('entry.complete', 'entry', p_entry_id::text, jsonb_build_object('participant_id', v_p.id));
end $$;

-- ---------------------------------------------------------------- registering a number (+ password in Vault)
drop function ref.submit_participant(text, text, text, text, date, time, text, boolean, uuid);
create or replace function ref.submit_participant(
  p_name text, p_wa text, p_email text, p_cloud_ref text, p_avail_date date, p_avail_time time,
  p_notes text, p_consent_wa boolean, p_password text, p_referrer_id uuid default null, p_avail_days smallint[] default null
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_role text := ref.require_role('admin', 'referral'); v_ref uuid; v_id uuid; v_wa text := erp.normalize_wa(p_wa);
        v_days smallint[]; v_secret uuid;
begin
  v_ref := case when v_role = 'referral' then ref.my_referrer_id() else p_referrer_id end;
  if v_ref is null then raise exception 'Pilih referral' using errcode = '22023'; end if;
  if not coalesce(p_consent_wa, false) then
    raise exception 'Pemilik nomor harus sudah setuju datanya didaftarkan' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'Password akun minimal 6 karakter' using errcode = '22023';
  end if;
  if length(p_password) > 200 then raise exception 'Password terlalu panjang' using errcode = '22023'; end if;
  if p_avail_date is not null and p_avail_date < erp.today() then
    raise exception 'Tanggal ketersediaan sudah lewat' using errcode = '22023';
  end if;
  if exists (select 1 from ref.participants where wa_norm = v_wa and status <> 'rejected') then
    raise exception 'Nomor WhatsApp ini sudah terdaftar' using errcode = '23505';
  end if;
  if exists (select 1 from ref.participants where email = lower(trim(p_email))::extensions.citext and status <> 'rejected') then
    raise exception 'Email ini sudah terdaftar' using errcode = '23505';
  end if;
  v_days := ref.clean_days(p_avail_days);
  insert into ref.participants (referrer_id, name, wa, email, cloud_ref, avail_date, avail_time, avail_days, notes, consent_wa, has_password)
  values (v_ref, trim(p_name), p_wa, lower(trim(p_email)), nullif(trim(p_cloud_ref), ''), p_avail_date, p_avail_time, v_days,
          nullif(trim(p_notes), ''), true, true)
  returning id into v_id;
  v_secret := vault.create_secret(p_password, 'ref_participant_' || v_id::text, 'Password nomor referral');
  insert into ref.participant_secrets (participant_id, secret_id) values (v_id, v_secret);
  perform ref.audit('participant.submit', 'participant', v_id::text, jsonb_build_object('referrer_id', v_ref));
  perform ref.notify_referrer(v_ref, 'registration_submitted', jsonb_build_object('participant_id', v_id, 'name', trim(p_name)));
  perform ref.notify_admins('new_participant', jsonb_build_object('participant_id', v_id, 'name', trim(p_name),
          'referrer', (select name from ref.referrers where id = v_ref)));
  return v_id;
end $$;

-- Weekdays: unique, sorted, 1..7; all seven days or none = any day (NULL).
create or replace function ref.clean_days(p_days smallint[])
returns smallint[] language sql immutable set search_path = ''
as $$
  select case when p_days is null or cardinality(p_days) = 0 then null
              when (select count(distinct d) from unnest(p_days) d where d between 1 and 7) >= 7 then null
              else (select array_agg(d order by d) from (select distinct d from unnest(p_days) d where d between 1 and 7) x) end
$$;

drop function ref.update_my_participant(uuid, text, text, text, text, date, time, text);
create or replace function ref.update_my_participant(
  p_id uuid, p_name text, p_wa text, p_email text, p_cloud_ref text, p_avail_date date, p_avail_time time, p_notes text,
  p_avail_days smallint[] default null, p_password text default null
) returns void language plpgsql security definer set search_path = ''
as $$
declare v_role text := ref.require_role('admin', 'referral'); v_secret uuid;
begin
  if p_password is not null and length(p_password) < 6 then
    raise exception 'Password akun minimal 6 karakter' using errcode = '22023';
  end if;
  update ref.participants
     set name = trim(p_name), wa = p_wa, email = lower(trim(p_email)), cloud_ref = nullif(trim(p_cloud_ref), ''),
         avail_date = p_avail_date, avail_time = p_avail_time, avail_days = ref.clean_days(p_avail_days), notes = nullif(trim(p_notes), '')
   where id = p_id
     and (v_role = 'admin' or (referrer_id = ref.my_referrer_id() and status = 'submitted'));
  if not found then raise exception 'Data tidak bisa diubah lagi' using errcode = '42501'; end if;
  if p_password is not null then
    select secret_id into v_secret from ref.participant_secrets where participant_id = p_id;
    if v_secret is null then
      v_secret := vault.create_secret(p_password, 'ref_participant_' || p_id::text, 'Password nomor referral');
      insert into ref.participant_secrets (participant_id, secret_id) values (p_id, v_secret);
      update ref.participants set has_password = true where id = p_id;
    else
      perform vault.update_secret(v_secret, p_password);
    end if;
  end if;
  perform ref.audit('participant.edit', 'participant', p_id::text, jsonb_build_object('password_changed', p_password is not null));
end $$;

-- Only roles listed in erp.settings.password_reveal_roles (owner, same as for ERP accounts). Every call is logged.
create or replace function ref.reveal_participant_password(p_participant_id uuid, p_reason text default 'reveal')
returns text language plpgsql security definer set search_path = ''
as $$
declare v_pw text;
begin
  if erp.my_role() is null or not exists (
    select 1 from erp.settings, jsonb_array_elements_text(value) r
     where key = 'password_reveal_roles' and r = erp.my_role()::text
  ) then
    raise exception 'Tidak punya akses melihat password' using errcode = '42501';
  end if;
  select s.decrypted_secret into v_pw
    from ref.participant_secrets ps join vault.decrypted_secrets s on s.id = ps.secret_id
   where ps.participant_id = p_participant_id;
  perform ref.audit('participant.password_' || left(coalesce(nullif(trim(p_reason), ''), 'reveal'), 30), 'participant', p_participant_id::text);
  return v_pw;
end $$;

-- A rejected number must not keep a password around: delete it. Sending the number again asks for the password again.
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
    update ref.participants set status = v_to, reject_reason = case when v_to = 'rejected' then trim(p_reason) end,
           has_password = case when v_to = 'rejected' then false else has_password end
     where id = v_p.id;
    if v_to = 'rejected' then
      delete from vault.secrets where id in (select secret_id from ref.participant_secrets where participant_id = v_p.id);
      delete from ref.participant_secrets where participant_id = v_p.id;
    end if;
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

-- Linking a number to its ERP account also hands the password over (server side, never through the browser),
-- unless the ERP account already has one.
create or replace function ref.link_erp_account(p_participant_id uuid, p_account_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_pw text; v_has boolean;
begin
  perform ref.require_role('admin');
  update ref.participants set erp_account_id = p_account_id where id = p_participant_id;
  select (password_secret_id is not null) into v_has from erp.accounts where id = p_account_id;
  if v_has is false then
    select s.decrypted_secret into v_pw from ref.participant_secrets ps join vault.decrypted_secrets s on s.id = ps.secret_id
     where ps.participant_id = p_participant_id;
    if v_pw is not null then perform erp.set_account_password(p_account_id, v_pw); end if;
  end if;
  perform ref.audit('participant.link_erp', 'participant', p_participant_id::text, jsonb_build_object('account_id', p_account_id));
end $$;

-- A referral made by an admin needs a WhatsApp number: the H-1 chat goes to it.
create or replace function ref.create_referrer(p_name text, p_wa text, p_email text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_user uuid; v_id uuid;
begin
  perform ref.require_role('admin');
  if length(coalesce(erp.normalize_wa(p_wa), '')) not between 10 and 15 then
    raise exception 'Nomor WhatsApp referral belum benar' using errcode = '22023';
  end if;
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

-- ---------------------------------------------------------------- reports
-- Per referral for a period. Activity is counted on its own date: numbers by the day they were entered, places by
-- their schedule day, commission by the day the number was completed (the commission row is made then).
create or replace function ref.referrer_performance(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform ref.require_role('admin');
  return (
    select coalesce(jsonb_agg(row_to_json(x) order by x.completed desc, x.participants desc, x.name), '[]'::jsonb)
    from (
      select r.id, r.name, r.username, r.active,
             ref.effective_rate(r.id) as rate, (r.commission_rate is not null) as custom_rate,
             (select count(*) from ref.participants p where p.referrer_id = r.id and p.entered_on between p_from and p_to) as participants,
             (select count(*) from ref.participants p where p.referrer_id = r.id and p.entered_on between p_from and p_to and p.status = 'rejected') as rejected,
             (select count(*) from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
               where p.referrer_id = r.id and e.day between p_from and p_to and e.state in ('active', 'completed')) as scheduled,
             (select count(*) from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
               where p.referrer_id = r.id and e.day between p_from and p_to and e.state in ('active', 'completed') and e.confirmation = 'available') as ready,
             (select count(*) from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
               where p.referrer_id = r.id and e.day between p_from and p_to and e.state in ('active', 'completed') and e.confirmation in ('unavailable', 'reschedule')) as not_ready,
             (select count(*) from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
               where p.referrer_id = r.id and e.day between p_from and p_to and e.state = 'completed') as completed,
             coalesce((select round(100.0 * count(*) filter (where e.state = 'completed') / nullif(count(*), 0), 1)
                         from ref.schedule_entries e join ref.participants p on p.id = e.participant_id
                        where p.referrer_id = r.id and e.day between p_from and p_to and e.state in ('active', 'completed')), 0) as conversion_pct,
             coalesce((select sum(c.amount) from ref.commissions c
                        where c.referrer_id = r.id and c.status <> 'void'
                          and (c.created_at at time zone 'Asia/Jakarta')::date between p_from and p_to), 0) as commission,
             coalesce((select sum(c.amount) from ref.commissions c
                        where c.referrer_id = r.id and c.status = 'pending'
                          and (c.created_at at time zone 'Asia/Jakarta')::date between p_from and p_to), 0) as pending_commission,
             coalesce((select sum(c.amount) from ref.commissions c
                        where c.referrer_id = r.id and c.status = 'approved'
                          and (c.created_at at time zone 'Asia/Jakarta')::date between p_from and p_to), 0) as approved_commission,
             coalesce((select sum(w.amount) from ref.withdrawals w
                        where w.referrer_id = r.id and w.status = 'paid'
                          and (w.paid_at at time zone 'Asia/Jakarta')::date between p_from and p_to), 0) as paid,
             ref.available_balance(r.id) as available
      from ref.referrers r
    ) x
  );
end $$;

-- ---------------------------------------------------------------- read models (columns are only appended)
create or replace view ref.participant_overview with (security_invoker = true) as
select
  p.id, p.referrer_id, r.name as referrer_name,
  p.name, p.wa, p.wa_norm, p.email, p.cloud_ref, p.avail_date, p.avail_time, p.notes, p.consent_wa,
  p.status, p.reject_reason, p.erp_account_id, p.entered_on, p.created_at, p.updated_at,
  e.id as entry_id, e.day as scheduled_day, e.start_time as scheduled_time, e.state as entry_state,
  e.confirmation,
  p.avail_days, p.has_password
from ref.participants p
join ref.referrers r on r.id = p.referrer_id
left join lateral (
  select * from ref.schedule_entries se
  where se.participant_id = p.id and se.state in ('active', 'completed')
  order by (se.state = 'active') desc, se.day desc
  limit 1
) e on true;

create or replace view ref.entry_overview with (security_invoker = true) as
select
  e.id, e.day, e.start_time, e.state, e.confirmation, e.confirmation_at, e.completed_at,
  p.id as participant_id, p.name, p.wa, p.wa_norm, p.email, p.cloud_ref, p.consent_wa, p.status,
  r.id as referrer_id, r.name as referrer_name,
  (select n.note from ref.ops_notes n where n.participant_id = p.id order by n.at desc limit 1) as last_note,
  r.wa as referrer_wa, p.avail_days, ref.actor_name(e.confirmation_by) as confirmation_by_name
from ref.schedule_entries e
join ref.participants p on p.id = e.participant_id
join ref.referrers r on r.id = p.referrer_id
where e.state in ('active', 'completed');

create or replace view ref.referrer_overview with (security_invoker = true) as
select r.id, r.name, r.username, r.wa, r.wa_norm, r.active, r.created_at,
       r.payout_method, r.payout_account, r.payout_name,
       inv.name as invited_by_name,
       (select count(*) from ref.referrers x where x.invited_by = r.id) as invited_count,
       (select count(*) from ref.participants p where p.referrer_id = r.id) as participants,
       (select count(*) from ref.participants p where p.referrer_id = r.id and p.status = 'completed') as completed,
       w.total_commission, w.pending_commission, w.approved_commission, w.on_hold, w.withdrawn, w.available,
       r.commission_rate,
       coalesce(r.commission_rate, (select (s.value #>> '{}')::bigint from ref.settings s where s.key = 'commission_per_completed'), 0) as effective_rate
from ref.referrers r
left join ref.referrers inv on inv.id = r.invited_by
left join ref.wallets w on w.referrer_id = r.id;

-- ---------------------------------------------------------------- grants
-- New functions get PUBLIC execute by default; anon has schema usage, so close it explicitly.
revoke execute on function
  ref.set_setting(text, jsonb), ref.confirm_closed(date), ref.actor_name(uuid), ref.public_info(),
  ref._apply_confirmation(uuid, ref.confirmation_status, text), ref.set_confirmation(uuid, ref.confirmation_status, text),
  ref.mark_referrer_contacted(date, uuid), ref.bulk_confirm(date, uuid, ref.confirmation_status),
  ref.confirm_my_day(date, uuid[], uuid[], text), ref.complete_entries(uuid[], text),
  ref.effective_rate(uuid), ref.set_referrer_rate(uuid, bigint, boolean), ref.complete_entry(uuid, text),
  ref.submit_participant(text, text, text, text, date, time, text, boolean, text, uuid, smallint[]),
  ref.clean_days(smallint[]),
  ref.update_my_participant(uuid, text, text, text, text, date, time, text, smallint[], text),
  ref.reveal_participant_password(uuid, text), ref.review_participants(uuid[], text, text),
  ref.link_erp_account(uuid, uuid), ref.create_referrer(text, text, text), ref.referrer_performance(date, date)
  from public, anon;
grant execute on function
  ref.set_setting(text, jsonb), ref.confirm_closed(date), ref.actor_name(uuid), ref.set_confirmation(uuid, ref.confirmation_status, text),
  ref.mark_referrer_contacted(date, uuid), ref.bulk_confirm(date, uuid, ref.confirmation_status),
  ref.confirm_my_day(date, uuid[], uuid[], text), ref.complete_entries(uuid[], text),
  ref.set_referrer_rate(uuid, bigint, boolean), ref.complete_entry(uuid, text),
  ref.submit_participant(text, text, text, text, date, time, text, boolean, text, uuid, smallint[]),
  ref.update_my_participant(uuid, text, text, text, text, date, time, text, smallint[], text),
  ref.reveal_participant_password(uuid, text), ref.review_participants(uuid[], text, text),
  ref.link_erp_account(uuid, uuid), ref.create_referrer(text, text, text), ref.referrer_performance(date, date)
  to authenticated;
-- internal helpers: only callable from inside the functions above
revoke execute on function ref._apply_confirmation(uuid, ref.confirmation_status, text), ref.effective_rate(uuid),
  ref.clean_days(smallint[]) from authenticated;

grant select on ref.participant_overview, ref.entry_overview, ref.referrer_overview to authenticated;
-- before login the Cara mulai page may read exactly this
grant execute on function ref.public_info() to anon, authenticated;
notify pgrst, 'reload schema';
