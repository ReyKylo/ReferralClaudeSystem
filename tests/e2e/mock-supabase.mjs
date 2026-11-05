// In-memory stand-in for Supabase (Auth + PostgREST schema `ref`) as one referral sees it. Used by the e2e tests and
// `npm run dev:mock`. It follows the SQL functions in supabase/migrations closely enough to drive every portal screen;
// the SQL itself is tested against a real Postgres in tests/sql. All data here is made up.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const DAY = 86400000;
const todayWIB = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
const addDays = (s, n) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10);
const norm = (raw) => { const d = String(raw ?? '').replace(/\D/g, ''); return d.startsWith('0') ? '62' + d.slice(1) : d.startsWith('8') ? '62' + d : d; };
const clean = (u) => String(u ?? '').trim().toLowerCase().replace(/^@/, '');
const DOMAIN = 'referral.tampilresmi.com';

export function createStore() {
  const today = todayWIB();
  const s = {
    settings: [
      { key: 'daily_target', value: 20 }, { key: 'commission_per_completed', value: 50000 }, { key: 'withdraw_min', value: 50000 },
      { key: 'withdraw_presets', value: [100000, 200000, 300000, 500000] }, { key: 'admin_wa', value: '6281299323591' },
      { key: 'payout_hours', value: 24 }, { key: 'login_email_domain', value: DOMAIN },
    ],
    users: [
      { id: 'u-gipong', email: `gipong@${DOMAIN}`, password: 'rahasia123' },
      { id: 'u-erp', email: 'owner@tampilresmi.com', password: 'rahasia123', erp: true },
    ],
    referrers: [
      { id: 'r-gipong', user_id: 'u-gipong', name: 'gipong', username: 'gipong', wa: '0812-1111-1111', active: true, invited_by: null, payout_method: 'BCA', payout_account: '1234567890', payout_name: 'Gipong Saputra' },
      { id: 'r-zakar', user_id: 'u-zakar', name: 'zakar', username: 'zakar', wa: '0812-2222-2222', active: true, invited_by: null, payout_method: null, payout_account: null, payout_name: null },
    ],
    participants: [], entries: [], events: [], commissions: [], withdrawals: [], notifications: [], seq: 0, nid: 0,
  };
  let i = 0;
  const mk = (name, status, enteredOn, extra = {}) => {
    const p = { id: `p-${i}`, referrer_id: 'r-gipong', name, wa: `0813-40${String(10 + i).padStart(2, '0')}-${String(1000 + i * 7)}`, email: `${name.toLowerCase().replace(/\s+/g, '.')}@gmail.com`,
      cloud_ref: null, avail_date: null, avail_time: '13:00', notes: null, status, reject_reason: null, entered_on: enteredOn,
      created_at: new Date(new Date(enteredOn + 'T02:00:00Z').getTime() + i * 1000).toISOString(), ...extra };
    i++;
    s.participants.push(p);
    s.events.push({ id: s.events.length + 1, participant_id: p.id, at: p.created_at, kind: 'status', from_value: null, to_value: 'submitted' });
    if (status !== 'submitted') s.events.push({ id: s.events.length + 1, participant_id: p.id, at: p.created_at, kind: 'status', from_value: 'submitted', to_value: status });
    return p;
  };
  const book = (p, day, confirmation, state = 'active') => s.entries.push({ participant_id: p.id, day, start_time: '13:00', state, confirmation });
  for (const [k, name] of ['Andi Pratama', 'Budi Santoso', 'Citra Lestari', 'Dewi Wijaya'].entries()) {
    const p = mk(name, 'completed', addDays(today, -8 + k)); book(p, addDays(today, -5 + k), 'available', 'completed');
    s.commissions.push({ id: `c-${p.id}`, referrer_id: 'r-gipong', participant_id: p.id, amount: 50000, status: k < 3 ? 'approved' : 'pending', created_at: addDays(today, -5 + k) + 'T10:00:00Z' });
  }
  book(mk('Eka Kusuma', 'confirmation_pending', addDays(today, -2)), addDays(today, 1), 'waiting');
  mk('Fajar Saputra', 'approved', addDays(today, -1));
  mk('Gita Rahma', 'submitted', today);
  const rj = mk('Hendra Nugroho', 'rejected', addDays(today, -2), { wa: '0813-9999-0000', reject_reason: 'Nomor WhatsApp tidak aktif' });
  s.withdrawals.push({ id: randomUUID(), seq: ++s.seq, referrer_id: 'r-gipong', amount: 50000, status: 'paid', payout_method: 'BCA', payout_account: '1234567890', payout_name: 'Gipong Saputra', requested_at: addDays(today, -4) + 'T08:00:00Z', decision_note: null, paid_at: addDays(today, -3) + 'T09:00:00Z', payment_reference: 'BCA TRX 88210' });
  const note = (kind, data, at) => s.notifications.push({ id: ++s.nid, referrer_id: 'r-gipong', kind, data, created_at: at, read_at: null });
  note('payment_completed', { amount: 50000 }, addDays(today, -3) + 'T09:00:00Z');
  note('registration_rejected', { participant_id: rj.id, name: rj.name, reason: rj.reject_reason }, addDays(today, -1) + 'T09:00:00Z');
  return s;
}

const wa = (r) => norm(r.wa);
function views(s, me) {
  const mine = (rows) => rows.filter((r) => r.referrer_id === me.id);
  const p = (x) => {
    const e = s.entries.filter((y) => y.participant_id === x.id && y.state !== 'cancelled').at(-1);
    return { ...x, wa_norm: norm(x.wa), scheduled_day: e?.day ?? null, scheduled_time: e?.start_time ?? null, entry_state: e?.state ?? null, confirmation: e?.confirmation ?? null };
  };
  const c = mine(s.commissions), w = mine(s.withdrawals);
  const sum = (rows) => rows.reduce((t, r) => t + r.amount, 0);
  const approved = sum(c.filter((x) => x.status === 'approved')), hold = sum(w.filter((x) => ['requested', 'approved'].includes(x.status))), paid = sum(w.filter((x) => x.status === 'paid'));
  return {
    settings: s.settings,
    referrers: s.referrers.filter((r) => r.id === me.id),
    participant_overview: mine(s.participants).map(p),
    participant_events: s.events.filter((e) => s.participants.some((x) => x.id === e.participant_id && x.referrer_id === me.id)),
    wallets: [{ total_commission: sum(c.filter((x) => x.status !== 'void')), pending_commission: sum(c.filter((x) => x.status === 'pending')), approved_commission: approved, on_hold: hold, withdrawn: paid, available: approved - hold - paid }],
    commission_items: c.map((x) => ({ ...x, participant_name: s.participants.find((y) => y.id === x.participant_id)?.name })),
    withdrawal_items: w.map((x) => ({ ...x, request_no: 'TS-' + String(x.seq).padStart(4, '0') })),
    notifications: mine(s.notifications),
  };
}

function rpc(s, fn, b, user, me) {
  const ok = (v) => ({ status: 200, body: v ?? null });
  const fail = (code, message) => ({ status: code === '42501' ? 403 : 400, body: { code, message, details: null, hint: null } });
  const avail = () => views(s, me).wallets[0].available;
  if (fn === 'signup_available') {
    const u = clean(b.p_username);
    return ok({ username_valid: /^[a-z0-9_.]{3,20}$/.test(u), username_free: !s.referrers.some((r) => r.username === u), wa_valid: norm(b.p_wa).length >= 10 && norm(b.p_wa).length <= 15, wa_free: !s.referrers.some((r) => wa(r) === norm(b.p_wa)) });
  }
  if (fn === 'login_email') {
    const id = String(b.p_identifier ?? '').trim(), r = s.referrers.find((x) => x.active && (x.username === clean(id) || (norm(id).length >= 10 && wa(x) === norm(id))));
    return ok(r && s.users.some((u) => u.id === r.user_id) ? `${r.username}@${DOMAIN}` : null);
  }
  if (!user) return fail('42501', 'Belum login');
  if (fn === 'register_me') {
    if (user.erp) return fail('22023', 'Login ini milik tim ERP, tidak bisa dijadikan referral');
    if (me) return ok(me.id);
    const u = clean(b.p_username);
    if (!/^[a-z0-9_.]{3,20}$/.test(u)) return fail('22023', 'Username 3-20 karakter: huruf kecil, angka, titik, atau garis bawah');
    if (user.email !== `${u}@${DOMAIN}`) return fail('22023', 'Username tidak cocok dengan login');
    if (norm(b.p_wa).length < 10 || norm(b.p_wa).length > 15) return fail('22023', 'Nomor WhatsApp belum benar');
    if (s.referrers.some((r) => wa(r) === norm(b.p_wa))) return fail('23505', 'Nomor WhatsApp ini sudah dipakai referral lain');
    const inviter = s.referrers.find((r) => r.active && r.username === clean(b.p_invite) && r.username !== u);
    const r = { id: randomUUID(), user_id: user.id, name: u, username: u, wa: String(b.p_wa).trim(), active: true, invited_by: inviter?.id ?? null, payout_method: null, payout_account: null, payout_name: null };
    s.referrers.push(r);
    if (inviter) s.notifications.push({ id: ++s.nid, referrer_id: inviter.id, kind: 'friend_joined', data: { username: u }, created_at: new Date().toISOString(), read_at: null });
    return ok(r.id);
  }
  if (!me) return fail('42501', 'Tidak punya akses');
  switch (fn) {
    case 'submit_participant': {
      if (!b.p_consent_wa) return fail('22023', 'Peserta harus setuju dihubungi lewat WhatsApp');
      if (s.participants.some((x) => x.status !== 'rejected' && norm(x.wa) === norm(b.p_wa))) return fail('23505', 'Nomor WhatsApp ini sudah terdaftar');
      if (s.participants.some((x) => x.status !== 'rejected' && x.email.toLowerCase() === String(b.p_email).trim().toLowerCase())) return fail('23505', 'Email ini sudah terdaftar');
      const p = { id: randomUUID(), referrer_id: me.id, name: b.p_name.trim(), wa: b.p_wa.trim(), email: b.p_email.trim().toLowerCase(), cloud_ref: b.p_cloud_ref, avail_date: b.p_avail_date, avail_time: b.p_avail_time,
        notes: b.p_notes, status: 'submitted', reject_reason: null, entered_on: todayWIB(), created_at: new Date().toISOString() };
      s.participants.push(p);
      s.events.push({ id: s.events.length + 1, participant_id: p.id, at: p.created_at, kind: 'status', from_value: null, to_value: 'submitted' });
      s.notifications.push({ id: ++s.nid, referrer_id: me.id, kind: 'registration_submitted', data: { participant_id: p.id, name: p.name }, created_at: p.created_at, read_at: null });
      return ok(p.id);
    }
    case 'update_my_payout':
      if (![b.p_method, b.p_account, b.p_name].every((v) => String(v ?? '').trim())) return fail('22023', 'Lengkapi bank/e-wallet, nomor, dan nama pemilik');
      Object.assign(me, { payout_method: b.p_method.trim(), payout_account: b.p_account.trim(), payout_name: b.p_name.trim() });
      return ok(null);
    case 'request_withdrawal': {
      if (!me.payout_account) return fail('22023', 'Isi rekening pencairan dulu');
      if (!(b.p_amount >= 50000)) return fail('22023', 'Minimal pencairan Rp 50000');
      if (b.p_amount > avail()) return fail('22023', `Saldo tersedia hanya Rp ${avail()}`);
      const w = { id: randomUUID(), seq: ++s.seq, referrer_id: me.id, amount: b.p_amount, status: 'requested', payout_method: me.payout_method, payout_account: me.payout_account, payout_name: me.payout_name, requested_at: new Date().toISOString(), decision_note: null, paid_at: null, payment_reference: null };
      s.withdrawals.push(w);
      return ok(w.id);
    }
    case 'cancel_my_withdrawal': {
      const w = s.withdrawals.find((x) => x.id === b.p_id && x.referrer_id === me.id && x.status === 'requested');
      if (!w) return fail('22023', 'Permintaan tidak bisa dibatalkan');
      w.status = 'cancelled';
      return ok(null);
    }
    case 'mark_notifications_read': {
      const rows = s.notifications.filter((n) => n.referrer_id === me.id && !n.read_at && (!b.p_ids || b.p_ids.includes(n.id)));
      rows.forEach((n) => (n.read_at = new Date().toISOString()));
      return ok(rows.length);
    }
    default: return { status: 404, body: { code: 'PGRST202', message: `Could not find the function ref.${fn}`, details: null, hint: null } };
  }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.mock`;
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() });
const session = (u) => ({ access_token: token(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r-' + u.id, user: userJson(u) });

export function startMock(port = 54322) {
  let s = createStore();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const send = (status, body, headers = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': req.headers.origin ?? '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range', ...headers });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };
      if (req.method === 'OPTIONS') return send(204);
      if (url.pathname === '/__reseed') { s = createStore(); return send(200, { ok: true }); }
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
      const claims = bearer.split('.')[1] ? (() => { try { return JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()); } catch { return null; } })() : null;
      const user = claims && s.users.find((u) => u.id === claims.sub);
      const me = user && s.referrers.find((r) => r.user_id === user.id && r.active);
      const path = url.pathname;

      if (path === '/auth/v1/signup') {
        const email = String(body.email).toLowerCase();
        if (s.users.some((u) => u.email === email)) return send(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
        const u = { id: randomUUID(), email, password: body.password };
        s.users.push(u);
        return send(200, session(u));
      }
      if (path === '/auth/v1/token') {
        const u = url.searchParams.get('grant_type') === 'refresh_token'
          ? s.users.find((x) => 'r-' + x.id === body.refresh_token)
          : s.users.find((x) => x.email === String(body.email).toLowerCase() && x.password === body.password);
        return u ? send(200, session(u)) : send(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (path === '/auth/v1/user') return user ? send(200, userJson(user)) : send(401, { code: 401, msg: 'invalid JWT' });
      if (path === '/auth/v1/logout') return send(204);
      if (!path.startsWith('/rest/v1/')) return send(404, { message: 'not found' });
      if ((req.headers['accept-profile'] || req.headers['content-profile']) !== 'ref') return send(406, { code: 'PGRST106', message: 'The schema must be ref' });

      if (path.startsWith('/rest/v1/rpc/')) {
        const r = rpc(s, path.slice('/rest/v1/rpc/'.length), body, user, me);
        return send(r.status, r.body);
      }
      if (req.method !== 'GET') return send(403, { code: '42501', message: 'permission denied' });
      if (!me && path !== '/rest/v1/referrers' && path !== '/rest/v1/settings') return send(200, []);
      const v = me ? views(s, me) : { referrers: [], settings: s.settings };
      let rows = v[path.slice('/rest/v1/'.length)];
      if (!rows) return send(404, { code: '42P01', message: 'relation does not exist' });
      for (const [k, val] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
        if (val.startsWith('eq.')) rows = rows.filter((r) => String(r[k]) === val.slice(3));
      }
      const order = (url.searchParams.get('order') ?? '').split(',').filter(Boolean).map((o) => { const [c, d] = o.split('.'); return [c, d === 'desc' ? -1 : 1]; });
      rows = [...rows].sort((a, b) => { for (const [c, d] of order) { if (a[c] === b[c]) continue; return (typeof a[c] === 'number' ? a[c] - b[c] : String(a[c]).localeCompare(String(b[c]))) * d; } return 0; });
      if (url.searchParams.get('offset')) rows = rows.slice(Number(url.searchParams.get('offset')));
      if (url.searchParams.get('limit')) rows = rows.slice(0, Number(url.searchParams.get('limit')));
      const cols = (url.searchParams.get('select') ?? '*').split(',');
      if (!cols.includes('*')) rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
      if (req.headers.accept?.includes('pgrst.object')) return rows.length === 1 ? send(200, rows[0]) : send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
      return send(200, rows);
    } catch (err) {
      console.error(err);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: String(err) }));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOCK_PORT ?? 54322);
  await startMock(port);
  console.log(`mock supabase (ref) on http://127.0.0.1:${port}  ·  login: gipong / rahasia123`);
}
