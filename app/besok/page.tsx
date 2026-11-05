'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Empty, Field, Icon, Skeleton, useToast, withBusy } from '@/components/ui';
import { confirmMyDay } from '@/lib/actions';
import { refreshAll, useEntries, useSettings } from '@/lib/data';
import { confirmState, fmtDeadline, fmtDL, fmtT, rel, waLink } from '@/lib/format';
import { errText } from '@/lib/supabase';
import type { Conf, Entry } from '@/lib/types';

type Pick = 'ready' | 'not';
/** What the team already knows about an entry. Anything else means "no answer yet". */
const known = (c: Conf): Pick | undefined => (c === 'available' ? 'ready' : c === 'unavailable' || c === 'reschedule' ? 'not' : undefined);

export default function Besok() {
  const entries = useEntries();
  const settings = useSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, Pick>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);

  const all = entries.data ?? [];
  const days = useMemo(() => [...new Set(all.map((e) => e.day))], [all]);
  const current = day && days.includes(day) ? day : days[0] ?? null;
  const rows = all.filter((e) => e.day === current);
  const deadline = settings.data?.confirmDeadline ?? '21:00';
  const adminWa = settings.data?.adminWa ?? '6281299323591';
  const st = current ? confirmState(current, deadline, now) : { closed: false, minutesLeft: null };
  const effective = (e: Entry) => pick[e.id] ?? known(e.confirmation);
  const changed = rows.filter((e) => pick[e.id] && pick[e.id] !== known(e.confirmation));
  const unanswered = rows.filter((e) => !effective(e)).length;

  const choose = (e: Entry, v: Pick) => setPick((p) => ({ ...p, [e.id]: v }));
  const allReady = () => setPick((p) => ({ ...p, ...Object.fromEntries(rows.map((e) => [e.id, 'ready' as Pick])) }));
  const send = () => withBusy(setBusy, async () => {
    try {
      await confirmMyDay(current!, changed.filter((e) => pick[e.id] === 'ready').map((e) => e.id), changed.filter((e) => pick[e.id] === 'not').map((e) => e.id), note);
      setPick({}); setNote('');
      await refreshAll(qc);
      toast('Konfirmasi terkirim. Terima kasih!');
    } catch (er) { toast(errText(er), true); }
  });

  const listText = current
    ? `${rel(current)}, ${fmtDL(current)}: ${rows.length} nomor\n` + rows.map((e, i) => `${i + 1}. ${e.name} · ${e.wa} · jam ${fmtT(e.start_time)}`).join('\n')
    : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(listText); toast('Daftar disalin'); }
    catch { toast('Tidak bisa menyalin. Pakai tombol Bagikan lewat WhatsApp.', true); }
  };

  if (entries.isLoading || settings.isLoading) return <Skeleton rows={4} />;
  if (!current) {
    return (
      <>
        <div className="head"><div><h1>Konfirmasi nomor</h1></div></div>
        <section className="card"><Empty icon="i-check" title="Belum ada nomor yang dijadwalkan">Anda dapat notifikasi saat tim menjadwalkan nomor Anda. Sehari sebelumnya, tim mengirim daftarnya ke WhatsApp Anda.</Empty></section>
      </>
    );
  }

  return (
    <>
      <div className="head">
        <div><h1>{rel(current)}: {rows.length} nomor</h1><p>{fmtDL(current)}. Kabari pemilik nomornya, lalu tandai yang siap atau tidak bisa.</p></div>
        {days.length > 1 && (
          <div className="seg" role="group" aria-label="Pilih hari">
            {days.slice(0, 5).map((d) => <button key={d} type="button" aria-pressed={d === current} onClick={() => { setDay(d); setPick({}); setNote(''); }}>{rel(d)}</button>)}
          </div>
        )}
      </div>

      {st.closed ? (
        <div className="note ic err" role="status"><Icon id="i-alert" /><span>Batas konfirmasi jam {fmtDeadline(deadline)} sudah lewat. Kalau ada perubahan, chat admin.</span></div>
      ) : (
        <div className={`note ic${st.minutesLeft !== null && st.minutesLeft < 120 ? ' err' : ''}`} role="status">
          <Icon id="i-alert" />
          <span>Konfirmasi paling lambat <b>jam {fmtDeadline(deadline)}</b>{st.minutesLeft !== null ? ` malam ini${st.minutesLeft < 120 ? `, tinggal ${st.minutesLeft} menit` : ''}` : ' sehari sebelumnya'}.</span>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h2>{unanswered ? `${unanswered} belum dijawab` : 'Semua sudah dijawab'}</h2>
          {!st.closed && <button type="button" className="btn btn-3 btn-sm" onClick={allReady}>Semua siap</button>}
        </div>
        <div className="list">
          {rows.map((e) => {
            const v = effective(e);
            return (
              <div className="row stack" key={e.id} data-entry={e.id}>
                <div className="prow-top">
                  <div className="prow"><b>{e.name}</b><span className="meta"><span className="num">jam {fmtT(e.start_time)}</span><span className="num">{e.wa}</span></span></div>
                  {v === 'ready' ? <Badge tone="ok">Siap</Badge> : v === 'not' ? <Badge tone="bad">Tidak bisa</Badge> : <Badge tone="warn">Belum dijawab</Badge>}
                </div>
                <div className="head-actions">
                  <div className="seg" role="group" aria-label={`Jawaban untuk ${e.name}`}>
                    <button type="button" aria-pressed={v === 'ready'} disabled={st.closed} onClick={() => choose(e, 'ready')}>Siap</button>
                    <button type="button" aria-pressed={v === 'not'} disabled={st.closed} onClick={() => choose(e, 'not')}>Tidak bisa</button>
                  </div>
                  <a className="btn wa btn-sm" href={waLink(e.wa, `Halo ${e.name.split(' ')[0]}, ${rel(current).toLowerCase()} ${fmtDL(current)} jam ${fmtT(e.start_time)} nomor kamu dipakai ya. Tolong siapkan HP-nya.`)} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Chat pemilik</a>
                </div>
              </div>
            );
          })}
        </div>
        {!st.closed && (
          <div className="card-pad grid" style={{ borderTop: '1px dashed var(--line)' }}>
            <Field id="b-note" label="Catatan untuk tim" textarea value={note} onChange={(e) => setNote(e.target.value)} optional help="Contoh: nomor kedua baru bisa jam 15.00." />
            <button type="button" className="btn btn-1 btn-block" disabled={busy || changed.length === 0} onClick={send}>
              {busy ? 'Mengirim…' : changed.length ? `Kirim konfirmasi (${changed.length})` : 'Pilih jawaban dulu'}
            </button>
          </div>
        )}
      </section>

      <section className="card card-pad grid" style={{ gap: 'var(--s3)' }}>
        <h2>Bagikan daftar</h2>
        <p className="meta-t">Salin daftar nomor ini atau kirim lewat WhatsApp, misalnya ke grup pemilik nomor.</p>
        <div className="head-actions">
          <button type="button" className="btn btn-3" onClick={copy}>Salin daftar</button>
          <a className="btn wa" href={`https://wa.me/?text=${encodeURIComponent(listText)}`} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Bagikan lewat WhatsApp</a>
          <a className="btn wa" href={waLink(adminWa, `Halo admin, saya mau tanya soal jadwal ${rel(current).toLowerCase()}.`)} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Chat admin</a>
        </div>
      </section>
      <p className="meta-t"><Link className="btn-link" href="/mulai/">Cara kerja jadwal dan komisi</Link></p>
    </>
  );
}
