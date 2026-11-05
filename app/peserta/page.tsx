'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PRow } from '@/components/PRow';
import { Empty, Field, Icon, PBadge, Road, Skeleton } from '@/components/ui';
import { useCommissions, useParticipant, useParticipants } from '@/lib/data';
import { addDays, fmtD, fmtDL, fmtT, normWa, todayWIB, waLink } from '@/lib/format';
import { hideReplaced, refLine, REFST } from '@/lib/status';
import type { Participant, PEvent } from '@/lib/types';

type F = 'all' | 'attn' | 'going' | 'done' | 'rejected';
const NAMES: Record<F, string> = { all: 'Semua', attn: 'Perlu perhatian', going: 'Berjalan', done: 'Selesai', rejected: 'Ditolak' };

export default function Page() {
  return <Suspense><Peserta /></Suspense>;
}

function Peserta() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get('id');
  const list = useParticipants();
  const comms = useCommissions();
  const [q, setQ] = useState('');
  const [f, setF] = useState<F>((params.get('filter') as F) || 'all');
  const all = useMemo(() => hideReplaced(list.data?.pages.flat() ?? []), [list.data]);
  const tomorrow = addDays(todayWIB(), 1);
  const groups: Record<F, (p: Participant) => boolean> = {
    all: () => true,
    attn: (p) => p.status === 'rejected' || (p.entry_state === 'active' && p.scheduled_day === tomorrow),
    going: (p) => !['completed', 'rejected'].includes(p.status),
    done: (p) => p.status === 'completed',
    rejected: (p) => p.status === 'rejected',
  };
  const text = q.trim().toLowerCase(), digits = normWa(q);
  const rows = all.filter(groups[f]).filter((p) => !text || p.name.toLowerCase().includes(text) || p.email.toLowerCase().includes(text) || (digits.length >= 4 && p.wa_norm.includes(digits)));
  const cOf = (pid: string) => comms.data?.find((c) => c.participant_id === pid && c.status !== 'void');

  return (
    <>
      <div className="head">
        <div><h1>Peserta</h1><p>Semua calon peserta yang Anda daftarkan. Ketuk nama untuk melihat detailnya.</p></div>
        <div className="head-actions"><Link className="btn btn-1" href="/daftar/"><Icon id="i-plus" />Daftarkan peserta</Link></div>
      </div>
      <section className="card">
        <div className="card-pad grid" style={{ gap: 'var(--s3)' }}>
          <Field id="q" label="Cari peserta" type="search" placeholder="Nama, email, atau nomor WA" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips" role="group" aria-label="Saring">
            {(Object.keys(NAMES) as F[]).map((k) => <button key={k} type="button" className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{NAMES[k]}<small>{all.filter(groups[k]).length}</small></button>)}
          </div>
        </div>
        <div className="list" style={{ borderTop: '1px dashed var(--line)' }}>
          {list.isLoading ? <Skeleton /> : rows.length ? rows.map((p) => <PRow key={p.id} p={p} c={cOf(p.id)} />)
            : <Empty>{q ? 'Tidak ada peserta dengan nama atau nomor itu.' : f === 'rejected' ? 'Tidak ada peserta yang ditolak.' : all.length ? 'Belum ada peserta di sini.' : 'Belum ada peserta. Tekan Daftarkan peserta untuk memulai.'}</Empty>}
        </div>
        {list.hasNextPage && <div className="card-pad" style={{ textAlign: 'center' }}><button className="btn btn-3" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>{list.isFetchingNextPage ? 'Memuat…' : 'Tampilkan lebih banyak'}</button></div>}
      </section>
      {id && <Detail id={id} onClose={() => router.push('/peserta/')} />}
    </>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useParticipant(id);
  const comms = useCommissions();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
  const p = d.data?.p;
  const c = p ? comms.data?.find((x) => x.participant_id === p.id && x.status !== 'void') : null;
  const tomorrow = addDays(todayWIB(), 1);
  const ev = (e: PEvent) => e.kind === 'status' ? `Status: ${REFST[(e.to_value ?? 'submitted') as keyof typeof REFST]?.label ?? e.to_value}`
    : e.to_value ? `Dijadwalkan ${fmtDL(e.to_value)}` : 'Jadwal dibatalkan';
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="dr-title">
        <div className="drawer-head">
          <div className="grid" style={{ gap: 'var(--s2)' }}><h1 id="dr-title">{p?.name ?? 'Memuat…'}</h1>{p && <PBadge p={p} />}</div>
          <button ref={ref} type="button" className="btn btn-3 btn-sm" onClick={onClose}>Tutup</button>
        </div>
        {d.isError && <div className="note err">Data gagal dimuat. <button className="btn-link" onClick={() => d.refetch()}>Coba lagi</button></div>}
        {d.data && !p && <div className="note">Peserta ini tidak ditemukan.</div>}
        {p && (
          <>
            <section className="card card-pad grid" style={{ gap: 'var(--s3)' }}>
              <Road p={p} labels />
              <p className="line-t">{refLine(p, c)}</p>
              {p.status === 'rejected' && <Link className="btn btn-1" href={`/daftar/?fix=${p.id}`}>Perbaiki dan kirim lagi</Link>}
              {p.entry_state === 'active' && p.scheduled_day === tomorrow && (
                <a className="btn wa" href={waLink(p.wa, `Halo ${p.name.split(' ')[0]}, jangan lupa besok ${fmtDL(tomorrow)} jam ${fmtT(p.scheduled_time)} ya.`)} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Ingatkan peserta</a>
              )}
            </section>
            <section className="card card-pad grid" style={{ gap: 'var(--s3)' }}>
              <div className="kv"><span>Nomor WhatsApp</span><span className="num">{p.wa}</span></div>
              <div className="kv"><span>Email</span><span>{p.email}</span></div>
              <div className="kv"><span>Bisa kapan</span><span>{p.avail_date ? fmtDL(p.avail_date) : 'Kapan saja'}{p.avail_time ? `, jam ${fmtT(p.avail_time)}` : ''}</span></div>
              <div className="kv"><span>Didaftarkan</span><span>{fmtDL(p.entered_on)}</span></div>
              {p.notes && <div className="kv"><span>Catatan</span><span>{p.notes}</span></div>}
            </section>
            <section className="card"><div className="card-head"><h2>Riwayat</h2></div>
              <div className="card-pad timeline">{(d.data?.events ?? []).map((e) => <div key={e.id}><time>{fmtD(e.at.slice(0, 10))}</time><span>{ev(e)}</span></div>)}</div>
            </section>
          </>
        )}
      </aside>
    </>
  );
}
