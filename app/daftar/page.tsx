'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Icon, Road, useToast, withBusy } from '@/components/ui';
import { submitParticipant, type ParticipantInput } from '@/lib/actions';
import { refreshAll, useParticipant } from '@/lib/data';
import { emailOk, fmtT, normWa, todayWIB, waOk } from '@/lib/format';
import { refLine } from '@/lib/status';
import { errText } from '@/lib/supabase';
import type { Participant } from '@/lib/types';

const TIMES: Array<[string, string]> = [['09:00', 'Pagi'], ['13:00', 'Siang'], ['16:00', 'Sore'], ['19:00', 'Malam']];
const EMPTY: ParticipantInput & { consent: boolean } = { name: '', wa: '', email: '', cloud: '', date: '', time: '', notes: '', consent: false };
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
  const [sent, setSent] = useState<Participant | null>(null);
  const loaded = useRef(false);

  // A draft survives switching to WhatsApp (or a reload) on a cheap phone.
  useEffect(() => {
    if (loaded.current) return;
    if (fixId) {
      const p = fix.data?.p;
      if (!p) return;
      setF({ ...EMPTY, name: p.name, wa: p.wa, email: p.email, cloud: p.cloud_ref ?? '', date: p.avail_date && p.avail_date >= todayWIB() ? p.avail_date : '', time: p.avail_time?.slice(0, 5) ?? '', notes: p.notes ?? '' });
      toast(`Data ${p.name} sudah terisi. Perbaiki yang salah, lalu kirim lagi.`);
    } else {
      try { const d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d) setF({ ...EMPTY, ...d, consent: false }); } catch { /* storage blocked */ }
    }
    loaded.current = true;
  }, [fixId, fix.data, toast]);
  useEffect(() => { if (loaded.current && !fixId) { try { localStorage.setItem(DRAFT, JSON.stringify({ ...f, consent: false })); } catch { /* storage blocked */ } } }, [f, fixId]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setF((x) => ({ ...x, [k]: e.target.value })); setErr((x) => ({ ...x, [k]: '' })); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (!f.name.trim()) fe.name = 'Isi nama peserta.';
    if (!f.wa.trim()) fe.wa = 'Isi nomor WhatsApp peserta.'; else if (!waOk(f.wa)) fe.wa = 'Nomor belum lengkap. Contoh: 0812-3456-7890.';
    if (!f.email.trim()) fe.email = 'Isi email peserta.'; else if (!emailOk(f.email)) fe.email = 'Email belum benar. Contoh: nama@gmail.com.';
    if (!f.consent) fe.consent = 'Centang dulu kalau peserta sudah setuju dihubungi.';
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
        else toast(m, true);
      }
    });
  };

  if (sent) {
    return (
      <section className="card card-pad done-screen" aria-live="polite">
        <span className="ico-ok"><Icon id="i-check" className="ico-lg" /></span>
        <h1>Pendaftaran {sent.name} terkirim</h1>
        <p className="muted">Tim akan mengecek datanya. Anda dapat notifikasi saat peserta diterima dan saat jadwalnya ditentukan.</p>
        <div style={{ width: '100%' }}><Road p={sent} labels /></div>
        <p className="line-t">{refLine(sent)}</p>
        <div className="head-actions">
          <Link className="btn btn-1" href="/daftar/" onClick={() => setSent(null)}><Icon id="i-plus" />Daftarkan peserta lain</Link>
          <Link className="btn btn-3" href="/peserta/">Lihat semua peserta</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="head"><div><h1>Daftarkan peserta</h1><p>Yang wajib hanya nama, nomor WhatsApp, dan email. Isian tersimpan di HP ini kalau Anda pindah ke WhatsApp.</p></div></div>
      <form className="card card-pad grid" onSubmit={submit} noValidate style={{ gap: 'var(--s5)' }}>
        <Field id="f-name" label="Nama peserta" autoComplete="off" value={f.name} onChange={set('name')} error={err.name} />
        <Field id="f-wa" label="Nomor WhatsApp peserta" type="tel" inputMode="tel" autoComplete="off" placeholder="0812-3456-7890" value={f.wa} onChange={set('wa')} error={err.wa} help="Tim akan menghubungi nomor ini untuk jadwal." />
        <Field id="f-email" label="Email peserta" type="email" inputMode="email" autoComplete="off" placeholder="nama@gmail.com" value={f.email} onChange={set('email')} error={err.email} help="Email yang dipakai peserta. Tanyakan ke peserta kalau belum tahu." />
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 'var(--t-meta)', fontWeight: 600, padding: 0, marginBottom: 'var(--s2)' }}>Jam yang cocok <span className="opt">(boleh kosong)</span></legend>
          <div className="chips">{TIMES.map(([v, l]) => <button key={v} type="button" className="chip" aria-pressed={f.time === v} onClick={() => setF((x) => ({ ...x, time: x.time === v ? '' : v }))}>{l}<small>{fmtT(v)}</small></button>)}</div>
        </fieldset>
        <Field id="f-date" label="Bisa mulai tanggal" type="date" min={todayWIB()} value={f.date} onChange={set('date')} optional help="Kosongkan kalau kapan saja bisa." />
        <details className="more" open={!!(f.cloud || f.notes)}>
          <summary>Data tambahan</summary>
          <div>
            <Field id="f-cloud" label="ID akun peserta" autoComplete="off" value={f.cloud} onChange={set('cloud')} optional help="Kalau peserta sudah punya akun, tulis ID atau namanya. Jangan pernah tulis password." />
            <Field id="f-notes" label="Catatan untuk tim" textarea value={f.notes} onChange={set('notes')} optional />
          </div>
        </details>
        <label className="check" htmlFor="f-consent" aria-invalid={err.consent ? true : undefined}>
          <input type="checkbox" id="f-consent" checked={f.consent} onChange={(e) => { setF((x) => ({ ...x, consent: e.target.checked })); setErr((x) => ({ ...x, consent: '' })); }} aria-describedby={err.consent ? 'f-consent-h' : undefined} />
          <span>Peserta sudah setuju dihubungi tim lewat WhatsApp.</span>
        </label>
        {err.consent && <span className="help bad" id="f-consent-h">{err.consent}</span>}
        <button className="btn btn-1 btn-block" type="submit" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim pendaftaran'}</button>
      </form>
    </>
  );
}
