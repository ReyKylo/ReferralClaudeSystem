'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase, errText } from '@/lib/supabase';
import { queryDefaults, refreshAll, useMe, useNotifications } from '@/lib/data';
import { registerMe, signOut } from '@/lib/actions';
import { waLink, waOk } from '@/lib/format';
import type { Me } from '@/lib/types';
import { Logo } from './Logo';
import { Field, Icon, Icons, ToastProvider, useOnline, useToast, withBusy } from './ui';

const NAV = [
  { href: '/', label: 'Beranda', icon: 'i-home', match: (p: string) => p === '/' },
  { href: '/peserta/', label: 'Peserta', icon: 'i-users', match: (p: string) => p.startsWith('/peserta') || p.startsWith('/daftar') },
  { href: '/saldo/', label: 'Saldo', icon: 'i-wallet', match: (p: string) => p.startsWith('/saldo') },
  { href: '/notifikasi/', label: 'Notifikasi', icon: 'i-bell', match: (p: string) => p.startsWith('/notifikasi') },
];
export const ADMIN_WA = '6281299323591'; // shown before login too (forgot password); settings.admin_wa wins once signed in

const MeCtx = createContext<Me | null>(null);
/** The signed-in referral. Every page under the shell can rely on it being set. */
export const useMeRow = () => useContext(MeCtx)!;

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: queryDefaults }));
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <Icons />
        <Gate>{children}</Gate>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const APP_PATHS = ['/', '/peserta/', '/daftar/', '/saldo/', '/notifikasi/'];

function Gate({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  const router = useRouter();
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // the sign-in page and the 404 page work without an account
  const publicPage = path.startsWith('/masuk') || !APP_PATHS.includes(path.replace(/\/?$/, '/'));

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => { setSession(s); qc.clear(); });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  const me = useMe(!!session);
  useEffect(() => {
    if (session === null && !publicPage) router.replace('/masuk/' + window.location.search);
    if (session && publicPage && me.data) router.replace('/');
  }, [session, publicPage, me.data, router]);

  if (publicPage) return <>{children}</>;
  if (session === undefined || (session && me.isLoading)) return <div className="spin" aria-busy="true">Memuat…</div>;
  if (!session) return <div className="spin">Membuka halaman masuk…</div>;
  if (me.isError) return <div className="center-page"><div className="note err" role="alert">{errText(me.error)} <button className="btn-link" onClick={() => me.refetch()}>Coba lagi</button></div></div>;
  if (!me.data) return <Finish email={session.user.email ?? ''} onDone={() => refreshAll(qc)} />;
  return <MeCtx.Provider value={me.data}><Frame path={path}>{children}</Frame></MeCtx.Provider>;
}

function Frame({ path, children }: { path: string; children: React.ReactNode }) {
  const me = useMeRow();
  const online = useOnline();
  const notes = useNotifications();
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;
  const counted = (href: string) => (href === '/notifikasi/' && unread ? <span className="count num">{unread}</span> : null);
  return (
    <div className="shell has-tabs" id="shell">
      <aside className="side" aria-label="Navigasi">
        <div><Logo /><div className="product">Referral</div></div>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={n.match(path) ? 'page' : undefined}><Icon id={n.icon} />{n.label}{counted(n.href)}</Link>
          ))}
        </nav>
        <div className="side-user side-foot"><span>Masuk sebagai <b>{me.username ?? me.name}</b></span><button type="button" onClick={() => signOut()}>Keluar</button></div>
      </aside>
      <div className="topbar"><div className="t1"><Logo /><button type="button" className="out-btn" onClick={() => signOut()}>Keluar</button></div></div>
      <main className="main">
        <div className="wrap narrow">
          {!online && <div className="offline note ic" role="status"><Icon id="i-wifi-off" /><span>Tidak tersambung internet. Yang sudah Anda ketik tetap tersimpan; kirim lagi setelah tersambung.</span></div>}
          {children}
        </div>
      </main>
      <nav className="tabs" aria-label="Menu">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} aria-current={n.match(path) ? 'page' : undefined}>
            <Icon id={n.icon} className="ico-lg" /><span>{n.label}</span>{counted(n.href)}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** A login without a referral row: finish sign-up, or explain why this login cannot use the portal. */
function Finish({ email, onDone }: { email: string; onDone: () => void }) {
  const toast = useToast();
  const [wa, setWa] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const username = email.split('@')[0];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!waOk(wa)) { setErr('Nomor belum lengkap. Contoh: 0812-3456-7890.'); return; }
    withBusy(setBusy, async () => {
      try {
        const invite = new URLSearchParams(window.location.search).get('ajak');
        await registerMe(username, wa, invite);
        onDone();
      } catch (er) {
        const m = errText(er);
        if (/tim ERP/i.test(m)) setBlocked('erp'); else if (/sudah dipakai/i.test(m)) setErr(m); else toast(m, true);
      }
    });
  };
  if (blocked === 'erp') return <div className="center-page"><section className="card card-pad grid" style={{ maxWidth: 480 }}><h1>Ini akun tim ERP</h1><p className="muted">Akun tim tidak dipakai di portal referral. Buka ERP di claudekita.tampilresmi.com.</p><div><button className="btn btn-3" onClick={() => signOut()}>Keluar</button></div></section></div>;
  return (
    <div className="center-page">
      <section className="card card-pad grid" style={{ width: 'min(480px, 100%)' }}>
        <div className="brand-top"><Logo /></div>
        <h1>Satu langkah lagi</h1>
        <p className="muted">Akun <b>{username}</b> sudah ada, tapi belum terdaftar sebagai referral. Isi nomor WhatsApp Anda untuk menyelesaikannya.</p>
        <p className="meta-t">Kalau akun ini pernah dinonaktifkan admin, hubungi admin lewat WhatsApp.</p>
        <form className="grid" onSubmit={submit} noValidate>
          <Field id="fin-wa" label="Nomor WhatsApp" type="tel" inputMode="tel" autoComplete="tel" placeholder="0812-3456-7890" value={wa} onChange={(e) => { setWa(e.target.value); setErr(''); }} error={err} />
          <button className="btn btn-1 btn-block" type="submit" disabled={busy}>{busy ? 'Mengirim…' : 'Selesaikan pendaftaran'}</button>
        </form>
        <div className="head-actions"><a className="btn wa" href={waLink(ADMIN_WA, 'Halo admin, akun referral saya tidak bisa dibuka.')} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Chat admin</a><button className="btn btn-3" onClick={() => signOut()}>Keluar</button></div>
      </section>
    </div>
  );
}
