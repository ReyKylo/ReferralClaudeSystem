import { fmtDL, fmtT, rp } from './format';
import type { Commission, Notification, Participant, PStatus } from './types';

export type Tone = 'ok' | 'warn' | 'bad' | 'neu';
/** Four steps on a paving road: Terkirim, Dicek, Dijadwalkan, Selesai. `now` = index of the current block (4 = all done). */
export const STEPS = ['Terkirim', 'Dicek', 'Dijadwalkan', 'Selesai'];
export const REFST: Record<PStatus, { label: string; tone: Tone; now: number }> = {
  submitted: { label: 'Terkirim', tone: 'neu', now: 1 }, under_review: { label: 'Sedang dicek', tone: 'warn', now: 1 },
  approved: { label: 'Diterima', tone: 'ok', now: 2 }, waiting_schedule: { label: 'Menunggu jadwal baru', tone: 'warn', now: 2 },
  scheduled: { label: 'Dijadwalkan', tone: 'ok', now: 2 }, confirmation_pending: { label: 'Dijadwalkan', tone: 'ok', now: 2 },
  confirmed: { label: 'Siap hadir', tone: 'ok', now: 2 }, completed: { label: 'Selesai', tone: 'ok', now: 4 }, rejected: { label: 'Ditolak', tone: 'bad', now: 1 },
};

/** One plain sentence about where a participant stands. */
export function refLine(p: Participant, commission?: Commission | null): string {
  const when = p.scheduled_day && p.entry_state === 'active' ? `${fmtDL(p.scheduled_day)} jam ${fmtT(p.scheduled_time)}` : '';
  switch (p.status) {
    case 'submitted': return 'Terkirim, menunggu dicek tim.';
    case 'under_review': return 'Tim sedang mengecek datanya.';
    case 'approved': return 'Diterima. Tim sedang mencarikan jadwal.';
    case 'waiting_schedule': return 'Nomor ini tidak bisa di jadwal sebelumnya. Tim akan mencarikan jadwal baru.';
    case 'scheduled': return `Dijadwalkan ${when}.`;
    case 'confirmation_pending': return `Dijadwalkan ${when}. Tim sedang menghubungi Anda.`;
    case 'confirmed': return `Siap ${when}.`;
    case 'completed': return commission ? (commission.status === 'approved' ? `Selesai. Komisi ${rp(commission.amount)} sudah masuk saldo.` : `Selesai. Komisi ${rp(commission.amount)} sedang dicek tim.`) : 'Selesai.';
    case 'rejected': return `Ditolak: ${p.reject_reason ?? 'lihat detail'}.`;
  }
}

/**
 * A rejected participant that was fixed and sent again shows up once: the old rejected row is hidden when a newer,
 * not-rejected row exists with the same WhatsApp number or email.
 */
export function hideReplaced(list: Participant[]): Participant[] {
  return list.filter((p) => p.status !== 'rejected' || !list.some((q) => q.status !== 'rejected' && q.created_at > p.created_at && (q.wa_norm === p.wa_norm || q.email.toLowerCase() === p.email.toLowerCase())));
}

/** Notification rows (kind + data from the SQL functions) as a sentence and the screen it belongs to. */
export function notifText(n: Notification): { text: string; to: string } {
  const d = n.data as Record<string, string | number | null | undefined>;
  const name = String(d.name ?? 'Nomor'), amount = rp(Number(d.amount ?? 0)), pid = d.participant_id ? `/peserta/?id=${d.participant_id}` : '/peserta/';
  switch (n.kind) {
    case 'registration_submitted': return { text: `Pendaftaran ${name} terkirim. Tim akan mengeceknya.`, to: pid };
    case 'registration_approved': return { text: `${name} diterima. Tim sedang mencarikan jadwal.`, to: pid };
    case 'registration_rejected': return { text: `${name} ditolak: ${d.reason ?? '-'}. Perbaiki datanya lalu kirim lagi.`, to: pid };
    case 'schedule_assigned': return { text: `${name} dijadwalkan ${d.day ? fmtDL(String(d.day)) : ''} jam ${fmtT(d.time as string)}.`, to: pid };
    case 'schedule_changed': return d.day ? { text: `Jadwal ${name} pindah ke ${fmtDL(String(d.day))} jam ${fmtT(d.time as string)}.`, to: pid } : { text: 'Jadwal nomor dibatalkan. Tim akan mencarikan jadwal baru.', to: pid };
    case 'commission_approved': return { text: `Komisi ${amount} dari ${name} masuk saldo.`, to: '/saldo/' };
    case 'withdrawal_approved': return { text: `Tarik saldo ${amount} disetujui. Admin segera mentransfer.`, to: '/saldo/' };
    case 'withdrawal_rejected': return { text: `Tarik saldo ${amount} ditolak: ${d.note ?? '-'}. Saldo dikembalikan.`, to: '/saldo/' };
    case 'payment_completed': return { text: `Tarik saldo ${amount} sudah ditransfer. Buktinya ada di menu Saldo.`, to: '/saldo/' };
    case 'rate_changed': return { text: `Komisi per nomor Anda sekarang ${rp(Number(d.rate ?? 0))}.`, to: '/saldo/' };
    case 'friend_joined': return { text: `${d.username ?? 'Teman Anda'} sudah daftar lewat link ajak Anda.`, to: '/' };
    default: return { text: 'Ada kabar baru.', to: '/' };
  }
}
