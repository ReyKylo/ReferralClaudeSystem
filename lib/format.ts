// Dates are 'YYYY-MM-DD' strings; "today" is the date in Asia/Jakarta (WIB). Money is whole rupiah.
const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const DAY = 86400000;

export const todayWIB = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const parse = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z');
export const addDays = (iso: string, n: number) => new Date(parse(iso).getTime() + n * DAY).toISOString().slice(0, 10);

/** "5 Nov" */
export const fmtD = (iso: string) => { const d = parse(iso); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}`; };
/** "Kamis, 5 Nov" */
export const fmtDL = (iso: string) => `${HARI[parse(iso).getUTCDay()]}, ${fmtD(iso)}`;
/** "Hari ini" / "Besok" / "Kemarin" / "Kamis, 5 Nov" */
export function rel(iso: string, today = todayWIB()) {
  const n = Math.round((parse(iso).getTime() - parse(today).getTime()) / DAY);
  return n === 0 ? 'Hari ini' : n === 1 ? 'Besok' : n === -1 ? 'Kemarin' : fmtDL(iso);
}
/** 09:00:00 -> 09.00 */
export const fmtT = (t: string | null | undefined) => (t ? t.slice(0, 5).replace(':', '.') : '-');
/** Rp50.000 */
export const rp = (n: number) => (n < 0 ? '−' : '') + 'Rp' + Math.abs(Math.round(n)).toLocaleString('id-ID');

/** 0812-3456-789 / +62 812… / 812… -> 62812… (same rule as erp.normalize_wa in the database). */
export function normWa(raw: string | null | undefined) {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) return '62' + d.slice(1);
  if (d.startsWith('8')) return '62' + d;
  return d;
}
export const waOk = (raw: string) => { const n = normWa(raw).length; return n >= 10 && n <= 15; };
export const waLink = (raw: string, text?: string) => `https://wa.me/${normWa(raw)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** ISO weekday (1 = Monday ... 7 = Sunday) of a 'YYYY-MM-DD'. */
export const isoWeekday = (iso: string) => parse(iso).getUTCDay() || 7;
export const DAY_SHORT = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
/** [1,3,5] -> "Sen, Rab, Jum"; none -> "Kapan saja" */
export const fmtDays = (days: number[] | null | undefined) => (days && days.length ? days.map((d) => DAY_SHORT[d - 1]).join(', ') : 'Kapan saja');

/** "21:00" -> 21.00 */
export const fmtDeadline = (hhmm: string) => hhmm.slice(0, 5).replace(':', '.');
/** Minutes since midnight in WIB. */
export const wibMinutes = (now = new Date()) => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(now).split(':').map(Number);
  return h * 60 + m;
};
/**
 * Same rule as ref.confirm_closed in the database: today and earlier are closed, tomorrow closes at the deadline (WIB).
 * `minutesLeft` is only set for tomorrow while it is still open. The database decides; this only shapes the screen.
 */
export function confirmState(day: string, deadline: string, now = new Date()): { closed: boolean; minutesLeft: number | null } {
  const today = todayWIB(now);
  if (day <= today) return { closed: true, minutesLeft: null };
  if (day !== addDays(today, 1)) return { closed: false, minutesLeft: null };
  const [h, m] = deadline.split(':').map(Number);
  const left = h * 60 + m - wibMinutes(now);
  return left <= 0 ? { closed: true, minutesLeft: null } : { closed: false, minutesLeft: left };
}
/** Only a path inside this site is accepted as "where to go after sign-in". */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

/** Username rule shared with ref.clean_username / referrers_username_format. */
export const cleanUsername = (u: string) => u.trim().toLowerCase();
export const usernameOk = (u: string) => /^[a-z0-9_.]{3,20}$/.test(cleanUsername(u));
export function usernameHint(u: string) {
  const v = cleanUsername(u);
  if (/\s/.test(v)) return `Tanpa spasi. Coba: ${v.replace(/\s+/g, '.').replace(/[^a-z0-9_.]/g, '')}`;
  return '3 sampai 20 huruf kecil, angka, titik, atau garis bawah.';
}
export const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
