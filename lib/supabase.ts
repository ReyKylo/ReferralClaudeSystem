import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Both values are public by design (they ship to every browser). What a visitor may read or do is decided by RLS and
// by the SQL functions in schema `ref`. Never put a service_role / secret key here.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vfttmslrjimbndseqqko.supabase.co';
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_awwsFMOYlZS3Abjy63XrHg_cAqUbIKR';

let client: SupabaseClient | undefined;
export function supabase() {
  client ??= createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'cp-referral-auth' } });
  return client;
}
export const ref = () => supabase().schema('ref');

/** Turns a database error into a sentence a referral can act on. The SQL functions already raise Indonesian messages. */
export function errText(e: unknown): string {
  const err = e as { message?: string; code?: string } | null;
  const m = err?.message ?? '';
  if (/fetch|network|Failed to fetch|NetworkError/i.test(m)) return 'Tidak tersambung internet. Periksa koneksi, lalu coba lagi.';
  if (err?.code === '42501') return 'Akun Anda tidak punya akses untuk ini. Hubungi admin.';
  if (m && !/^(JWT|PGRST|invalid input)/i.test(m)) return m.replace(/^ERROR:\s*/, '');
  return 'Belum berhasil. Coba lagi sebentar lagi.';
}
