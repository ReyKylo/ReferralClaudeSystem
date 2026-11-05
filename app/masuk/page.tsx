'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { ADMIN_WA } from '@/components/Shell';
import { Field, Icon, withBusy } from '@/components/ui';
import { signIn, signUp, signupAvailable } from '@/lib/actions';
import { cleanUsername, usernameHint, usernameOk, waLink, waOk } from '@/lib/format';
import { errText } from '@/lib/supabase';

const DOMAIN = 'referral.tampilresmi.com'; // = ref.settings.login_email_domain (settings are not readable before login)

export default function Page() {
  return <Suspense><Masuk /></Suspense>;
}

function Masuk() {
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get('ajak');
  const [tab, setTab] = useState<'daftar' | 'masuk'>('daftar');
  // Someone who signed in on this phone before most likely wants to sign in again; an invite link means a new person.
  useEffect(() => { try { if (!invite && localStorage.getItem('cp-has-account')) setTab('masuk'); } catch { /* storage blocked */ } }, [invite]);
  const [user, setUser] = useState('');
  const [wa, setWa] = useState('');
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [free, setFree] = useState<{ user?: boolean; wa?: boolean }>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reg = tab === 'daftar';

  // Check username and number while typing (one request per pause, not per key).
  useEffect(() => {
    if (!reg) return;
    clearTimeout(timer.current);
    if (!usernameOk(user) && !waOk(wa)) { setFree({}); return; }
    timer.current = setTimeout(async () => {
      try {
        const r = await signupAvailable(usernameOk(user) ? user : '', waOk(wa) ? wa : '');
        setFree({ user: usernameOk(user) ? r.username_free : undefined, wa: waOk(wa) ? r.wa_free : undefined });
      } catch { /* offline: the final submit checks again */ }
    }, 400);
  }, [user, wa, reg]);

  const userErr = err.user || (user && !usernameOk(user) ? usernameHint(user) : free.user === false ? 'Sudah dipakai orang lain. Coba tambah angka di belakangnya.' : '');
  const waErr = err.wa || (free.wa === false ? 'Nomor ini sudah punya akun. Pilih Masuk di atas.' : '');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fe: Record<string, string> = {};
    if (reg) {
      if (!user.trim()) fe.user = 'Isi nama pengguna dulu.'; else if (!usernameOk(user)) fe.user = usernameHint(user); else if (free.user === false) fe.user = 'Sudah dipakai orang lain. Coba tambah angka di belakangnya.';
      if (!wa.trim()) fe.wa = 'Isi nomor WhatsApp dulu.'; else if (!waOk(wa)) fe.wa = 'Nomor belum lengkap. Contoh: 0812-3456-7890.'; else if (free.wa === false) fe.wa = 'Nomor ini sudah punya akun. Pilih Masuk di atas.';
      if (pw.length < 6) fe.pw = 'Password minimal 6 huruf atau angka.';
    } else if (!id.trim() || !pw) fe.form = 'Isi nama pengguna atau nomor WhatsApp, dan password.';
    setErr(fe);
    if (Object.keys(fe).length) { document.querySelector<HTMLElement>('[aria-invalid="true"], #a-id')?.focus(); return; }
    withBusy(setBusy, async () => {
      try {
        if (reg) await signUp(cleanUsername(user), wa, pw, DOMAIN, invite);
        else await signIn(id, pw);
        try { localStorage.setItem('cp-has-account', '1'); } catch { /* storage blocked */ }
        router.replace('/');
      } catch (er) {
        const m = errText(er);
        if (reg && /already registered|already exists/i.test(m)) setErr({ user: 'Nama pengguna ini sudah dipakai. Coba tambah angka di belakangnya.' });
        else if (reg && /WhatsApp/i.test(m)) setErr({ wa: m });
        else if (reg && /signups not allowed|Signups not allowed/i.test(m)) setErr({ form: 'Pendaftaran sedang ditutup. Hubungi admin lewat WhatsApp.' });
        else setErr({ form: m });
      }
    });
  };

  const pwToggle = <button type="button" className="btn btn-3" aria-pressed={show} aria-controls="a-pw" onClick={() => setShow((s) => !s)}>{show ? 'Sembunyikan' : 'Lihat'}</button>;
  return (
    <div className="center-page">
      <div style={{ width: 'min(480px, 100%)' }}>
        <div className="brand-top"><Logo /></div>
        <section className="card card-pad grid" style={{ gap: 'var(--s5)' }}>
          <div className="grid" style={{ gap: 'var(--s2)' }}>
            <h1>{reg ? 'Buat akun referral' : 'Masuk ke akun Anda'}</h1>
            <p className="muted">{reg ? 'Cukup nama pengguna, nomor WhatsApp, dan password. Tidak perlu email, langsung bisa dipakai.' : 'Pakai nama pengguna atau nomor WhatsApp yang Anda daftarkan.'}</p>
            {reg && invite && <div className="note ic"><Icon id="i-users" /><span>Anda diajak oleh <b>{invite}</b>.</span></div>}
          </div>
          <div className="seg full" role="group" aria-label="Pilih daftar atau masuk">
            <button type="button" aria-pressed={reg} onClick={() => { setTab('daftar'); setErr({}); }}>Daftar baru</button>
            <button type="button" aria-pressed={!reg} onClick={() => { setTab('masuk'); setErr({}); }}>Masuk</button>
          </div>
          <form className="grid" onSubmit={submit} noValidate>
            {reg ? (
              <>
                <Field id="a-user" label="Nama pengguna (username)" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="contoh: budi.santoso"
                  value={user} onChange={(e) => { setUser(e.target.value); setErr((x) => ({ ...x, user: '' })); }} error={userErr}
                  ok={free.user === true} help={free.user === true ? 'Bisa dipakai.' : 'Dipakai untuk masuk. Huruf kecil, angka, titik, atau garis bawah. Tanpa spasi.'} />
                <Field id="a-wa" label="Nomor WhatsApp" type="tel" inputMode="tel" autoComplete="tel" placeholder="0812-3456-7890"
                  value={wa} onChange={(e) => { setWa(e.target.value); setErr((x) => ({ ...x, wa: '' })); }} error={waErr}
                  ok={free.wa === true} help={free.wa === true ? 'Nomor bisa dipakai.' : 'Nomor ini juga bisa dipakai untuk masuk.'} />
                <Field id="a-pw" label="Password" type={show ? 'text' : 'password'} autoComplete="new-password" value={pw}
                  onChange={(e) => { setPw(e.target.value); setErr((x) => ({ ...x, pw: '' })); }} error={err.pw} help="Minimal 6 huruf atau angka." after={pwToggle} />
              </>
            ) : (
              <>
                <Field id="a-id" label="Nama pengguna atau nomor WhatsApp" autoComplete="username" autoCapitalize="none" spellCheck={false} value={id} onChange={(e) => setId(e.target.value)} />
                <Field id="a-pw" label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} after={pwToggle} />
              </>
            )}
            {err.form && <div className="note ic err" role="alert"><Icon id="i-alert" /><span>{err.form}</span></div>}
            <button className="btn btn-1 btn-block" type="submit" disabled={busy}>{busy ? (reg ? 'Membuat akun…' : 'Masuk…') : reg ? 'Daftar dan masuk' : 'Masuk'}</button>
          </form>
          {!reg && (
            <div>
              <button type="button" className="btn-link" aria-expanded={forgot} onClick={() => setForgot((f) => !f)}>Lupa password?</button>
              {forgot && (
                <div className="grid" style={{ gap: 'var(--s3)', marginTop: 'var(--s2)' }}>
                  <p className="meta-t">Chat admin di WhatsApp dan sebutkan nomor WhatsApp Anda. Admin akan membuatkan password baru.</p>
                  <div><a className="btn wa" href={waLink(ADMIN_WA, 'Halo admin, saya lupa password akun referral saya.')} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Chat admin</a></div>
                  <p className="meta-t">Nomor admin: <span className="num">0812-9932-3591</span></p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
