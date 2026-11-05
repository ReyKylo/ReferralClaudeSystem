'use client';

/*
 * Every read the portal makes. Light on Supabase like the ERP: a referral only ever loads their own rows (RLS),
 * lists come 50 at a time, results are cached for a minute, nothing polls and nothing refetches on window focus.
 */
import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query';
import { ref } from './supabase';
import type { Commission, Me, Notification, Participant, PEvent, Settings, Wallet, Withdrawal } from './types';

export const PAGE = 50;
export const queryDefaults = { queries: { staleTime: 60_000, gcTime: 10 * 60_000, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: 1 } } as const;
export const refreshAll = (qc: QueryClient) => qc.invalidateQueries({ refetchType: 'active' });
const must = <T,>(r: { data: unknown; error: unknown }): T => { if (r.error) throw r.error; return r.data as T; };

const P_COLS = 'id,name,wa,wa_norm,email,cloud_ref,avail_date,avail_time,notes,status,reject_reason,entered_on,created_at,scheduled_day,scheduled_time,entry_state,confirmation';

/** The signed-in referral's own row, or null when the login is not (or no longer) an active referral. */
export function useMe(enabled: boolean) {
  return useQuery({
    queryKey: ['me'], enabled,
    queryFn: async () => must<Me | null>(await ref().from('referrers').select('id,name,username,wa,payout_method,payout_account,payout_name').maybeSingle()),
  });
}

export function useSettings(enabled = true) {
  return useQuery({
    queryKey: ['settings'], enabled, staleTime: 10 * 60_000,
    queryFn: async () => {
      const rows = must<Array<{ key: string; value: unknown }>>(await ref().from('settings').select('key,value'));
      const get = (k: string) => rows.find((r) => r.key === k)?.value;
      return {
        adminWa: String(get('admin_wa') ?? '6281299323591'), payoutHours: Number(get('payout_hours') ?? 24),
        commission: Number(get('commission_per_completed') ?? 50000), withdrawMin: Number(get('withdraw_min') ?? 50000),
        presets: (get('withdraw_presets') as number[] | undefined) ?? [100000, 200000, 300000, 500000],
        loginDomain: String(get('login_email_domain') ?? 'referral.tampilresmi.com'),
      } satisfies Settings;
    },
  });
}

export function useParticipants() {
  return useInfiniteQuery({
    queryKey: ['participants'],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => must<Participant[]>(await ref().from('participant_overview').select(P_COLS)
      .order('created_at', { ascending: false }).order('id').range(pageParam, pageParam + PAGE - 1)),
    getNextPageParam: (last: unknown[], all: unknown[][]) => (last.length === PAGE ? all.length * PAGE : undefined),
  });
}

export function useParticipant(id: string | null) {
  return useQuery({
    queryKey: ['participant', id], enabled: !!id,
    queryFn: async () => {
      const db = ref();
      const [p, ev] = await Promise.all([
        db.from('participant_overview').select(P_COLS).eq('id', id!).maybeSingle(),
        db.from('participant_events').select('id,at,kind,from_value,to_value').eq('participant_id', id!).order('at', { ascending: false }).limit(30),
      ]);
      return { p: must<Participant | null>(p), events: must<PEvent[]>(ev) };
    },
  });
}

export function useWallet(enabled = true) {
  return useQuery({
    queryKey: ['wallet'], enabled,
    queryFn: async () => (must<Wallet | null>(await ref().from('wallets').select('total_commission,pending_commission,approved_commission,on_hold,withdrawn,available').maybeSingle())) ?? { total_commission: 0, pending_commission: 0, approved_commission: 0, on_hold: 0, withdrawn: 0, available: 0 },
  });
}

export function useCommissions() {
  return useQuery({
    queryKey: ['commissions'],
    queryFn: async () => must<Commission[]>(await ref().from('commission_items').select('id,participant_id,participant_name,amount,status,created_at').order('created_at', { ascending: false }).limit(PAGE)),
  });
}

export function useWithdrawals() {
  return useQuery({
    queryKey: ['withdrawals'],
    queryFn: async () => must<Withdrawal[]>(await ref().from('withdrawal_items')
      .select('id,amount,status,payout_method,payout_account,payout_name,requested_at,decision_note,paid_at,payment_reference,request_no')
      .order('requested_at', { ascending: false }).limit(PAGE)),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => must<Notification[]>(await ref().from('notifications').select('id,kind,data,created_at,read_at').order('created_at', { ascending: false }).limit(PAGE)),
  });
}
