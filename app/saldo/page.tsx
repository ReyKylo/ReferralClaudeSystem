'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useMeRow } from '@/components/Shell';
import { Badge, Field, Icon, Skeleton, useToast, withBusy } from '@/components/ui';
import { cancelWithdrawal, requestWithdrawal, updatePayout } from '@/lib/actions';
import { refreshAll, useCommissions, useSettings, useWallet, useWithdrawals } from '@/lib/data';
import { fmtDL, rp, waLink } from '@/lib/format';
import { errText, ref } from '@/lib/supabase';
import type { Tone } from '@/lib/status';
import type { Withdrawal } from '@/lib/types';

const BANKS = ['BCA', 'BRI', 'BNI', 'Mandiri', 'BSI', 'CIMB Niaga', 'Permata', 'DANA', 'GoPay', 'OVO', 'ShopeePay'];
const WST: Record<Withdrawal['status'], [string, Tone]> = { requested: ['Menunggu admin', 'warn'], approved: ['Disetujui, segera ditransfer', 'ok'], rejected: ['Ditolak', 'bad'], cancelled: ['Dibatalkan', 'neu'], paid: ['Sudah ditransfer', 'ok'] };

export default function Saldo() {
  const me = useMeRow();
  const qc = useQueryClient();
  const toast = useToast();
  const wallet = useWallet();
  const settings = useSettings();
  const ws = useWithdrawals();
  const comms = useCommissions();
  const [amt, setAmt] = useState<number | null>(null);
  const [custom, setCustom] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Withdrawal | null>(null);
  const [edit, setEdit] = useState(false);
  const [bank, setBank] = useState('');
  const [other, setOther] = useState('');
  const [acct, setAcct] = useState('');
  const [holder, setHolder] = useState('');
  const [pe, setPe] = useState<Record<string, string>>({});
  const s = settings.data, w = wallet.data;
  const hasPayout = !!me.payout_account;
  const amount = custom ? Number(custom) : amt ?? 0;
  const amtErr = !amount || !s || !w ? '' : amount < s.withdrawMin ? `Minimal ${rp(s.withdrawMin)}.` : amount > w.available ? `Saldo Anda ${rp(w.available)}.` : '';
  const okAmt = !!amount && !amtErr;

  const openPayout = () => {
    const known = BANKS.includes(me.payout_method ?? '');
    setBank(me.payout_method ? (known ? me.payout_method! : 'lain') : ''); setOther(known ? '' : me.payout_method ?? '');
    setAcct(me.payout_account ?? ''); setHolder(me.payout_name ?? ''); setPe({}); setEdit(true);
  };
  const savePayout = (e: React.FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    const method = bank === 'lain' ? other.trim() : bank;
    if (!bank) err.bank = 'Pilih bank atau e-wallet.';
    if (bank === 'lain' && !other.trim()) err.other = 'Tulis nama bank atau e-wallet.';
    if (!acct.trim()) err.acct = 'Isi nomor rekening, VA, atau nomor e-wallet.';
    if (!holder.trim()) err.holder = 'Isi nama pemilik rekening.';
    setPe(err);
    if (Object.keys(err).length) return;
    withBusy(setBusy, async () => {
      try { await updatePayout(method, acct.trim(), holder.trim()); await refreshAll(qc); setEdit(false); toast('Rekening disimpan'); }
      catch (er) { toast(errText(er), true); }
    });
  };
  const send = () => withBusy(setBusy, async () => {
    try {
      const id = await requestWithdrawal(amount);
      const r = await ref().from('withdrawal_items').select('id,amount,status,payout_method,payout_account,payout_name,requested_at,decision_note,paid_at,payment_reference,request_no').eq('id', id).single();
      if (r.error) throw r.error;
      setReceipt(r.data as Withdrawal); setConfirm(false); setAmt(null); setCustom('');
      await refreshAll(qc); window.scrollTo(0, 0);
    } catch (er) { toast(errText(er), true); }
  });
  const cancel = (x: Withdrawal) => withBusy(setBusy, async () => {
    try { await cancelWithdrawal(x.id); setReceipt(null); await refreshAll(qc); toast(`Dibatalkan. ${rp(x.amount)} kembali ke saldo.`); }
    catch (er) { toast(errText(er), true); }
  });
  const waText = (x: Withdrawal) => `Halo admin, saya ${me.username ?? me.name} mau tarik saldo ${rp(x.amount)}.\nNomor permintaan: ${x.request_no}\nKirim ke: ${x.payout_method} ${x.payout_account} a.n. ${x.payout_name}`;

  if (!s || !w) return <Skeleton rows={4} />;
  const opts = [...s.presets.filter((v) => v < w.available), w.available].filter((v) => v >= s.withdrawMin);
  return (
    <>
      <div className="head"><div><h1>Saldo</h1><p>Komisi masuk ke saldo setelah peserta selesai dan dicek tim.</p></div></div>

      {receipt && (
        <section className="receipt" aria-live="polite">
          <h2><Icon id="i-check" />Permintaan tarik saldo terkirim</h2>
          <div className="kv"><span>Nomor</span><span className="mono">{receipt.request_no}</span></div>
          <div className="kv"><span>Jumlah</span><b className="num">{rp(receipt.amount)}</b></div>
          <div className="kv"><span>Dikirim ke</span><span>{receipt.payout_method} {receipt.payout_account}</span></div>
          <p><b>Langkah terakhir:</b> kirim detail ini ke WhatsApp admin. Uang ditransfer paling lambat 1x{s.payoutHours} jam setelah pesannya terkirim.</p>
          <div><a className="btn btn-1" href={waLink(s.adminWa, waText(receipt))} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Kirim ke WhatsApp admin</a></div>
          <p className="meta-t">Bukti transfer nanti muncul di Riwayat di bawah, dan Anda dapat notifikasi.</p>
          {receipt.status === 'requested' && <div><button type="button" className="btn btn-3 btn-sm" disabled={busy} onClick={() => cancel(receipt)}>Batalkan permintaan ini</button></div>}
        </section>
      )}

      <section className="card card-pad grid" style={{ gap: 'var(--s4)' }}>
        <div className="money"><span className="label">Bisa ditarik</span><span className="big">{rp(w.available)}</span></div>
        <div className="money-rows">
          <div><span>Komisi sedang dicek tim</span><b>{rp(w.pending_commission)}</b></div>
          {w.on_hold > 0 && <div><span>Sedang diproses admin</span><b>{rp(w.on_hold)}</b></div>}
          <div><span>Sudah masuk rekening Anda</span><b>{rp(w.withdrawn)}</b></div>
        </div>
      </section>

      {!receipt && (
        <section className="card card-pad grid">
          <h2>Tarik saldo</h2>
          {w.available < s.withdrawMin ? (
            <div className="note ic"><Icon id="i-alert" /><span>Saldo bisa ditarik mulai {rp(s.withdrawMin)}. Saldo bertambah setiap peserta Anda selesai dan dicek tim.</span></div>
          ) : !hasPayout || edit ? (
            <form className="grid" onSubmit={savePayout} noValidate>
              <p className="muted">Ke mana uangnya dikirim?</p>
              <div className="field"><label htmlFor="pay-m">Bank atau e-wallet</label>
                <select className="input" id="pay-m" value={bank} aria-invalid={pe.bank ? true : undefined} onChange={(e) => { setBank(e.target.value); setPe((x) => ({ ...x, bank: '' })); }}>
                  <option value="">Pilih…</option>{BANKS.map((b) => <option key={b}>{b}</option>)}<option value="lain">Lainnya</option>
                </select>{pe.bank && <span className="help bad">{pe.bank}</span>}</div>
              {bank === 'lain' && <Field id="pay-o" label="Nama bank atau e-wallet lain" value={other} onChange={(e) => setOther(e.target.value)} error={pe.other} />}
              <Field id="pay-a" label="Nomor rekening, VA, atau nomor e-wallet" inputMode="numeric" value={acct} onChange={(e) => setAcct(e.target.value)} error={pe.acct} />
              <Field id="pay-n" label="Nama pemilik rekening" value={holder} onChange={(e) => setHolder(e.target.value)} error={pe.holder} help="Sesuai nama di bank atau e-wallet." />
              <div className="head-actions"><button type="submit" className="btn btn-2" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan rekening'}</button>{hasPayout && <button type="button" className="btn btn-3" onClick={() => setEdit(false)}>Batal</button>}</div>
            </form>
          ) : (
            <div className="grid" style={{ gap: 'var(--s3)' }}>
              <span className="field"><span>Mau tarik berapa?</span></span>
              <div className="chips" role="group" aria-label="Pilih nominal">
                {opts.map((v) => <button key={v} type="button" className="chip" aria-pressed={!custom && amt === v} onClick={() => { setAmt(v); setCustom(''); setConfirm(false); }}>{v === w.available ? <>Semua <small>{rp(v)}</small></> : rp(v)}</button>)}
              </div>
              <Field id="w-custom" label="Atau ketik nominal" inputMode="numeric" placeholder={`Minimal ${rp(s.withdrawMin)}`}
                value={custom ? Number(custom).toLocaleString('id-ID') : ''} onChange={(e) => { setCustom(e.target.value.replace(/\D/g, '')); setAmt(null); setConfirm(false); }} error={custom ? amtErr : ''} />
              <p className="meta-t">Dikirim ke <b>{me.payout_method} {me.payout_account}</b> a.n. {me.payout_name}.</p>
              <div><button type="button" className="btn btn-3 btn-sm" onClick={openPayout}>Ganti rekening</button></div>
              {confirm && okAmt ? (
                <div className="confirm" role="group" aria-label="Konfirmasi tarik saldo">
                  <b>Tarik {rp(amount)} ke {me.payout_method} {me.payout_account} a.n. {me.payout_name}?</b>
                  <span className="meta-t">Setelah ini Anda kirim detailnya ke WhatsApp admin. Uang ini ditahan dari saldo sampai admin selesai mentransfer (paling lambat 1x{s.payoutHours} jam).</span>
                  <div className="head-actions"><button type="button" className="btn btn-1" disabled={busy} onClick={send}>{busy ? 'Mengirim…' : 'Ya, tarik saldo'}</button><button type="button" className="btn btn-3" onClick={() => setConfirm(false)}>Batal</button></div>
                </div>
              ) : <button type="button" className="btn btn-1 btn-block" disabled={!okAmt} onClick={() => setConfirm(true)}>{okAmt ? `Tarik ${rp(amount)}` : 'Pilih nominal dulu'}</button>}
            </div>
          )}
        </section>
      )}

      <details className="more card">
        <summary>Cara kerja komisi</summary>
        <div>
          <p>Setiap peserta Anda yang selesai memberi komisi {rp(s.commission)}. Tim mengecek dulu, lalu komisinya masuk ke saldo.</p>
          <p>Saldo bisa ditarik mulai {rp(s.withdrawMin)}. Setelah mengajukan, kirim detailnya ke WhatsApp admin. Uang masuk ke rekening, VA, atau e-wallet Anda paling lambat 1x{s.payoutHours} jam, dan buktinya muncul di Riwayat.</p>
          <div><a className="btn wa" href={waLink(s.adminWa, 'Halo admin, saya mau tanya soal saldo referral saya.')} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Tanya admin</a></div>
        </div>
      </details>

      <section className="card">
        <div className="card-head"><h2>Riwayat tarik saldo</h2></div>
        <div className="list">
          {(ws.data ?? []).map((x) => (
            <div className="row" key={x.id}>
              <div className="prow">
                <div className="prow-top"><b className="num">{rp(x.amount)}</b><Badge tone={WST[x.status][1]}>{WST[x.status][0]}</Badge></div>
                <span className="meta-t">{fmtDL(x.requested_at.slice(0, 10))} ke {x.payout_method} {x.payout_account}</span>
                <span className="meta-t">Nomor permintaan <span className="mono">{x.request_no}</span></span>
                {x.status === 'paid' && <span className="meta-t">Bukti transfer: <span className="mono">{x.payment_reference}</span></span>}
                {x.status === 'rejected' && <span className="meta-t">Alasan: {x.decision_note ?? '-'}. Saldo sudah dikembalikan.</span>}
              </div>
              {x.status === 'requested' && <button type="button" className="btn btn-3 btn-sm" disabled={busy} onClick={() => cancel(x)}>Batalkan</button>}
            </div>
          ))}
          {ws.data && !ws.data.length && <div className="empty"><span>Belum pernah tarik saldo.</span></div>}
        </div>
      </section>

      {(comms.data ?? []).length > 0 && (
        <details className="more card">
          <summary>Asal komisi ({comms.data!.length} peserta)</summary>
          <div className="list" style={{ padding: 0 }}>
            {comms.data!.map((c) => (
              <div className="row" key={c.id}>
                <div className="prow"><b>{c.participant_name}</b><span className="meta-t">Selesai {fmtDL(c.created_at.slice(0, 10))}</span></div>
                <div className="prow" style={{ justifyItems: 'end' }}><b className="num">{rp(c.amount)}</b><Badge tone={c.status === 'approved' ? 'ok' : c.status === 'pending' ? 'warn' : 'neu'}>{c.status === 'approved' ? 'Masuk saldo' : c.status === 'pending' ? 'Sedang dicek' : 'Batal'}</Badge></div>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
