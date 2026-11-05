'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Icon, Road, useToast, withBusy } from '@/components/ui';
import { submitParticipant, type ParticipantInput } from '@/lib/actions';
import { refreshAll, useParticipant } from '@/lib/data';
import { DAY_SHORT, emailOk, fmtT, normWa, todayWIB, waOk } from '@/lib/format';
import { refLine } from '@/lib/status';
import { errText } from '@/lib/supabase';
import type { Participant } from '@/lib/types';

const TIMES: Array<[string, string]> = [['09:00', 'Pagi'], ['13:00', 'Siang'], ['16:00', 'Sore'], ['19:00', 'Malam']];
const EMPTY: ParticipantInput & { consent: boolean } = { name: '', wa: '', email: '', password: '', days: [], cloud: '', date: '', time: '', notes: '', consent: false };
const DRAFT = 'cp-ref-draft';

export default function Page() {
  return <Suspense><Daftar /></Suspense>;
}

function Daftar() {
  const params = useSearchParams();
  const fixId = params.get('fix');
  const fix = useParticipant(fixId);
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);
  const [sent, setSent] = useState<Participant | null>(null);
  const loaded = useRef(false);

  // A draft survives switching to WhatsApp (or a reload) on a cheap phone. The password and the consent are never kept.
  useEffect(() => {
    if (loaded.current) return;
    if (fixId) {
      const p = fix.data?.p;
      if (!p) return;
      setF({ ...EMPTY, name: p.name, wa: p.wa, email: p.email, days: p.avail_days ?? [], cloud: p.cloud_ref ?? '', date: p.avail_date && p.avail_date >= todayWIB() ? p.avail_date : '', time: p.avail_time?.slice(0, 5) ?? '', notes: p.notes ?? '' });
      toast(`Data ${p.name} sudah terisi. Perbaiki yang salah, isi password lagi, lalu kirim lagi.`);
    } else {
      try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d) setF({ ...EMPTY, ...d, password: '', consent: false }); } catch { /* storage blocked */ }
    }
    loaded.current = true;
  }, [fixId, fix.data, toast]);
  useEffect(() => { if (loaded.current && !fixId) { try { localStorage.setItem(DRAFT, JSON.stringify({ ...f, password: '', consent: false })); } catch { /* storage blocked */ } } }, [f, fixId]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setF((x) => ({ ...x, [k]: e.target.value })); setErr((x) => ({ ...x, [k]: '' })); };
  const toggleDay = (d: number) => setF((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d].sort() }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!f.name.trim()) fe.name = 'Isi nama pemilik nomor.';
    if (!f.wa.trim()) fe.wa = 'Isi nomor WhatsApp.'; else if (!waOk(f.wa)) fe.wa = 'Nomor belum lengkap. Contoh: 0812-3456-7890.';
    if (!f.email.trim()) fe.email = 'Isi email.'; else if (!emailOk(f.email)) fe.email = 'Email belum benar. Contoh: nama@gmail.com.';
    if (f.password.length < 6) fe.password = 'Isi password akun, minimal 6 karakter.';
    if (!f.consent) fe.consent = 'Centang dulu kalau pemilik nomor sudah setuju.';
    const old = fix.data?.p;
    if (old && !fe.wa && /whatsapp/i.test(old.reject_reason ?? '') && normWa(f.wa) === old.wa_norm) fe.wa = `Nomor ini yang tadi ditolak (${(old.reject_reason ?? '').toLowerCase()}). Ganti dengan nomor WhatsApp yang aktif.`;
    setErr(fe);
    if (Object.keys(fe).length) { setTimeout(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()); return; }
    withBusy(setBusy, async () => {
      try {
        await submitParticipant(f);
        try { localStorage.removeItem(DRAFT); } catch { /* storage blocked */ }
        await refreshAll(qc);
        setSent({ name: f.name.trim(), status: 'submitted' } as Participant);
        setF(EMPTY);
        window.scrollTo(0, 0);
      } catch (er) {
        const m = errText(er);
        if (/WhatsApp/i.test(m) && /terdaftar/i.test(m)) setErr({ wa: 'Nomor ini sudah didaftarkan sebelumnya, oleh Anda atau referral lain.' });
        else if (/Email/i.test(m) && /terdaftar/i.test(m)) setErr({ email: 'Email ini sudah didaftarkan sebelumnya, oleh Anda atau referral lain.' });
        else if (/Password/i.test(m)) setErr({ password: m });
        else toast(m, true);
      }
    });
  };

  if (sent) {
    return (
      <section className="card card-pad done-screen" aria-live="polite">
        <span className="ico-ok"><Icon id="i-check" className="ico-lg" /></span>
        <h1>Nomor {sent.name} terkirim</h1>
        <p className="muted">Tim akan mengecek datanya. Anda dapat notifikasi saat nomor diterima dan saat jadwalnya ditentukan.</p>
        <div style={{ width: '100%' }}><Road p={sent} labels /></div>
        <p className="line-t">{refLine(sent)}</p>
        <div className="head-actions">
          <Link className="btn btn-1" href="/daftar/" onClick={() => setSent(null)}><Icon id="i-plus" />Daftarkan nomor lain</Link>
          <Link className="btn btn-3" href="/peserta/">Lihat semua nomor</Link>
        </div>
      </section>
    );
  }

  const pwToggle = <button type="button" className="btn btn-3" aria-pressed={show} aria-controls="f-pw" onClick={() => setShow((s) => !s)}>{show ? 'Sembunyikan' : 'Lihat'}</button>;
  return (
    <>
      <div className="head"><div><h1>Daftarkan nomor</h1><p>Yang wajib: nama pemilik, nomor WhatsApp, email, dan password akunnya. Isian tersimpan di HP ini kalau Anda pindah ke WhatsApp.</p></div></div>
      <form className="card card-pad grid" onSubmit={submit} noValidate style={{ gap: 'var(--s5)' }}>
        <Field id="f-name" label="Nama pemilik nomor" autoComplete="off" value={f.name} onChange={set('name')} error={err.name} />
        <Field id="f-wa" label="Nomor WhatsApp" type="tel" inputMode="tel" autoComplete="off" placeholder="0812-3456-7890" value={f.wa} onChange={set('wa')} error={err.wa} help="Nomor ini dipakai untuk jadwal." />
        <Field id="f-email" label="Email" type="email" inputMode="email" autoComplete="off" placeholder="nama@gmail.com" value={f.email} onChange={set('email')} error={err.email} help="Email yang dipakai pemilik nomor. Tanyakan kalau belum tahu." />
        <Field id="f-pw" label="Password akun" type={show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={set('password')} error={err.password} after={pwToggle}
          help="Password untuk email di atas. Disimpan terenkripsi dan hanya tim yang bisa membukanya. Jangan tulis kode OTP di sini." />
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 'var(--t-meta)', fontWeight: 600, padding: 0, marginBottom: 'var(--s2)' }}>Bisa hari apa</legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={f.days.length === 0} onClick={() => setF((x) => ({ ...x, days: [] }))}>Kapan saja</button>
            {DAY_SHORT.map((l, i) => <button key={l} type="button" className="chip" aria-pressed={f.days.includes(i + 1)} onClick={() => toggleDay(i + 1)}>{l}</button>)}
          </div>
          <span className="help">Tim mengecek ulang sehari sebelumnya.</span>
        </fieldset>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 'var(--t-meta)', fontWeight: 600, padding: 0, marginBottom: 'var(--s2)' }}>Jam yang cocok <span className="opt">(boleh kosong)</span></legend>
          <div className="chips">{TIMES.map(([v, l]) => <button key={v} type="button" className="chip" aria-pressed={f.time === v} onClick={() => setF((x) => ({ ...x, time: x.time === v ? '' : v }))}>{l}<small>{fmtT(v)}</small></button>)}</div>
        </fieldset>
        <Field id="f-date" label="Bisa mulai tanggal" type="date" min={todayWIB()} value={f.date} onChange={set('date')} optional help="Kosongkan kalau kapan saja bisa." />
        <details className="more" open={!!(f.cloud || f.notes)}>
          <summary>Data tambahan</summary>
          <div>
            <Field id="f-cloud" label="ID akun" autoComplete="off" value={f.cloud} onChange={set('cloud')} optional help="Kalau sudah punya akun, tulis ID atau namanya." />
            <Field id="f-notes" label="Catatan untuk tim" textarea value={f.notes} onChange={set('notes')} optional />
          </div>
        </details>
        <label className="check" htmlFor="f-consent" aria-invalid={err.consent ? true : undefined}>
          <input type="checkbox" id="f-consent" checked={f.consent} onChange={(e) => { setF((x) => ({ ...x, consent: e.target.checked })); setErr((x) => ({ ...x, consent: '' })); }} aria-describedby={err.consent ? 'f-consent-h' : undefined} />
          <span>Pemilik nomor sudah setuju datanya didaftarkan dan dijadwalkan lewat saya.</span>
        </label>
        {err.consent && <span className="help bad" id="f-consent-h">{err.consent}</span>}
        <button className="btn btn-1 btn-block" type="submit" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim pendaftaran'}</button>
      </form>
    </>
  );
}
