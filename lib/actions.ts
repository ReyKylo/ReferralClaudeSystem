// Every write is one SQL function in schema `ref`; the database checks who is calling and validates the data.
import { ref, supabase } from './supabase';
import { cleanUsername } from './format';

async function call<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await ref().rpc(fn, args);
  if (r.error) throw r.error;
  return r.data as T;
}

export const signupAvailable = (username: string, wa: string) =>
  call<{ username_valid: boolean; username_free: boolean; wa_valid: boolean; wa_free: boolean }>('signup_available', { p_username: username, p_wa: wa });

/**
 * Sign up without email: the login address is <username>@<domain>, which never receives mail ("Confirm email" is off).
 * The username and number are checked on the server first, so a taken number never leaves a half-made login behind.
 * If one exists anyway (the page closed between the two steps), signing up again with the same password finishes it.
 */
export async function signUp(username: string, wa: string, password: string, domain: string, invite: string | null) {
  const u = cleanUsername(username), email = `${u}@${domain}`;
  const chk = await signupAvailable(u, wa);
  if (!chk.wa_free) throw new Error('Nomor WhatsApp ini sudah dipakai referral lain. Pilih Masuk di atas.');
  if (!chk.username_free) throw new Error('User already registered');
  const { data, error } = await supabase().auth.signUp({ email, password });
  if (error && /already registered|already exists/i.test(error.message)) {
    const again = await supabase().auth.signInWithPassword({ email, password });
    if (again.error) throw error;
  } else if (error) throw error;
  else if (!data.session) throw new Error('Akun dibuat, tapi belum bisa langsung masuk. Admin perlu mematikan "Confirm email" di Supabase.');
  await call('register_me', { p_username: u, p_wa: wa, p_invite: invite });
}

/** For a login that exists but was never turned into a referral (e.g. the page closed right after sign-up). */
export const registerMe = (username: string, wa: string, invite: string | null) => call('register_me', { p_username: cleanUsername(username), p_wa: wa, p_invite: invite });

/** Username or WhatsApp number + password. */
export async function signIn(identifier: string, password: string) {
  const email = await call<string | null>('login_email', { p_identifier: identifier.trim() });
  if (!email) throw new Error('Username/nomor atau password salah. Coba lagi, atau pilih Lupa password.');
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error('Username/nomor atau password salah. Coba lagi, atau pilih Lupa password.');
}
export const signOut = () => supabase().auth.signOut();

export interface ParticipantInput { name: string; wa: string; email: string; cloud: string; date: string; time: string; notes: string }
export const submitParticipant = (f: ParticipantInput) => call<string>('submit_participant', {
  p_name: f.name, p_wa: f.wa, p_email: f.email, p_cloud_ref: f.cloud || null, p_avail_date: f.date || null,
  p_avail_time: f.time || null, p_notes: f.notes || null, p_consent_wa: true,
});
export const updatePayout = (method: string, account: string, name: string) => call('update_my_payout', { p_method: method, p_account: account, p_name: name });
export const requestWithdrawal = (amount: number) => call<string>('request_withdrawal', { p_amount: amount });
export const cancelWithdrawal = (id: string) => call('cancel_my_withdrawal', { p_id: id });
export const markNotificationsRead = (ids: number[] | null) => call('mark_notifications_read', { p_ids: ids });
