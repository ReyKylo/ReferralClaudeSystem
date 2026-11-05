'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMeRow } from '@/components/Shell';
import { PRow } from '@/components/PRow';
import { Empty, Icon, Skeleton, useToast } from '@/components/ui';
import { useCommissions, useNotifications, useParticipants, useWallet } from '@/lib/data';
import { addDays, fmtDL, fmtT, rp, todayWIB, waLink } from '@/lib/format';
import { hideReplaced } from '@/lib/status';

const PORTAL = 'referral.tampilresmi.com';

export default function Beranda() {
  const me = useMeRow();
  const toast = useToast();
  const list = useParticipants();
  const wallet = useWallet();
  const comms = useCommissions();
  const notes = useNotifications();
  const [copied, setCopied] = useState(false);
  const all = useMemo(() => hideReplaced(list.data?.pages.flat() ?? []), [list.data]);
  const cOf = (id: string) => comms.data?.find((c) => c.participant_id === id && c.status !== 'void');
  const tomorrow = addDays(todayWIB(), 1);
  const going = all.filter((p) => !['completed', 'rejected'].includes(p.status)).length;
  const done = all.filter((p) => p.status === 'completed').length;
  const attn = [
    ...all.filter((p) => p.status === 'rejected').map((p) => ({ p, kind: 'fix' as const })),
    ...all.filter((p) => p.entry_state === 'active' && p.scheduled_day === tomorrow).map((p) => ({ p, kind: 'remind' as const })),
  ];
  const friends = (notes.data ?? []).filter((n) => n.kind === 'friend_joined').length;
  const link = `${PORTAL}/masuk/?ajak=${me.username ?? ''}`;
  const w = wallet.data;

  const copy = async () => {
    try { await navigator.clipboard.writeText(`https://${link}`); setCopied(true); toast('Link ajak disalin'); }
    catch { (document.getElementById('inviteLink') as HTMLInputElement | null)?.select(); toast('Tekan lama pada link untuk menyalin', true); }
  };

  return (
    <>
      <div className="head"><div><h1>Beranda</h1>{all.length > 0 && <p>{going} peserta sedang berjalan, {done} sudah selesai.</p>}</div></div>
      <Link className="btn btn-1 btn-block" href="/daftar/"><Icon id="i-plus" />Daftarkan peserta</Link>
      <section className="card">
        <Link className="row" href="/saldo/" aria-label={`Saldo bisa ditarik ${w ? rp(w.available) : ''}. Buka Saldo`}>
          <div className="money">
            <span className="label">Saldo bisa ditarik</span>
            <span className="big">{w ? rp(w.available) : '…'}</span>
            {w && w.pending_commission > 0 && <span className="meta-t">{rp(w.pending_commission)} lagi sedang dicek tim</span>}
            <span className="btn-link" style={{ minHeight: 0, padding: 0, marginTop: 'var(--s2)' }}>Tarik saldo</span>
          </div>
          <Icon id="i-chev" className="go" />
        </Link>
      </section>
      {attn.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>Perlu perhatian</h2></div>
          <div className="list">
            {attn.slice(0, 4).map(({ p, kind }) => kind === 'fix' ? (
              <div className="row" key={'f' + p.id}><div className="prow"><b>{p.name} ditolak</b><span className="meta-t">{p.reject_reason}. Perbaiki datanya lalu kirim lagi.</span></div><Link className="btn btn-3 btn-sm" href={`/daftar/?fix=${p.id}`}>Perbaiki</Link></div>
            ) : (
              <div className="row" key={'r' + p.id}><div className="prow"><b>{p.name} dijadwalkan besok jam {fmtT(p.scheduled_time)}</b><span className="meta-t">Ingatkan peserta supaya siap. Tim juga akan menghubunginya.</span></div>
                <a className="btn wa btn-sm" href={waLink(p.wa, `Halo ${p.name.split(' ')[0]}, jangan lupa besok ${fmtDL(tomorrow)} jam ${fmtT(p.scheduled_time)} ya.`)} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Ingatkan</a></div>
            ))}
          </div>
          {attn.length > 4 && <div className="card-pad"><Link className="btn-link" href="/peserta/?filter=attn">Lihat semua ({attn.length})</Link></div>}
        </section>
      )}
      <section className="card card-pad grid" style={{ gap: 'var(--s3)' }}>
        <h2>Ajak teman jadi referral</h2>
        <p className="meta-t">Kirim link ini ke teman. Mereka daftar sendiri dan punya akun referral sendiri.{friends > 0 && ` Sudah ${friends} teman daftar lewat link Anda.`}</p>
        <div className="pw"><input className="input num" id="inviteLink" readOnly value={`https://${link}`} aria-label="Link ajak Anda" /><button type="button" className="btn btn-3" onClick={copy}>{copied ? 'Disalin' : 'Salin'}</button></div>
        <div><a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(`Yuk jadi referral CodePave. Daftarnya cuma pakai nama pengguna, nomor WhatsApp, dan password: https://${link}`)}`} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Bagikan lewat WhatsApp</a></div>
      </section>
      <section className="card">
        <div className="card-head"><h2>Peserta terbaru</h2>{all.length > 5 && <Link className="btn-link" href="/peserta/">Lihat semua</Link>}</div>
        {list.isLoading ? <Skeleton /> : all.length ? (
          <div className="list">{all.slice(0, 5).map((p) => <PRow key={p.id} p={p} c={cOf(p.id)} />)}</div>
        ) : <Empty title="Belum ada peserta">Daftarkan calon peserta pertama Anda. Setelah dicek tim, statusnya muncul di sini.</Empty>}
      </section>
    </>
  );
}
