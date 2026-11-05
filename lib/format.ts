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

/** Username rule shared with ref.clean_username / referrers_username_format. */
export const cleanUsername = (u: string) => u.trim().toLowerCase();
export const usernameOk = (u: string) => /^[a-z0-9_.]{3,20}$/.test(cleanUsername(u));
export function usernameHint(u: string) {
  const v = cleanUsername(u);
  if (/\s/.test(v)) return `Tanpa spasi. Coba: ${v.replace(/\s+/g, '.').replace(/[^a-z0-9_.]/g, '')}`;
  return '3 sampai 20 huruf kecil, angka, titik, atau garis bawah.';
}
export const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
