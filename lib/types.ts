// Rows of schema `ref` as a referral sees them (RLS limits every query to their own data).
export type PStatus =
  | 'submitted' | 'under_review' | 'approved' | 'waiting_schedule' | 'scheduled'
  | 'confirmation_pending' | 'confirmed' | 'completed' | 'rejected';
export type Conf = 'not_contacted' | 'contacted' | 'waiting' | 'available' | 'unavailable' | 'reschedule';

export interface Me { id: string; name: string; username: string | null; wa: string | null; payout_method: string | null; payout_account: string | null; payout_name: string | null; commission_rate: number | null }

export interface Participant {
  id: string; name: string; wa: string; wa_norm: string; email: string; cloud_ref: string | null;
  avail_date: string | null; avail_time: string | null; notes: string | null; status: PStatus; reject_reason: string | null;
  entered_on: string; created_at: string; scheduled_day: string | null; scheduled_time: string | null;
  entry_state: 'active' | 'completed' | null; confirmation: Conf | null;
  entry_id: string | null; avail_days: number[] | null; has_password: boolean;
}
/** One booked place of one of my numbers (ref.entry_overview). */
export interface Entry { id: string; day: string; start_time: string | null; state: 'active' | 'completed'; confirmation: Conf; participant_id: string; name: string; wa: string; status: PStatus }
export interface PEvent { id: number; at: string; kind: string; from_value: string | null; to_value: string | null }
export interface Wallet { total_commission: number; pending_commission: number; approved_commission: number; on_hold: number; withdrawn: number; available: number }
export interface Commission { id: string; participant_id: string; participant_name: string; amount: number; status: 'pending' | 'approved' | 'void'; created_at: string }
export interface Withdrawal {
  id: string; amount: number; status: 'requested' | 'approved' | 'rejected' | 'cancelled' | 'paid';
  payout_method: string; payout_account: string; payout_name: string; requested_at: string;
  decision_note: string | null; paid_at: string | null; payment_reference: string | null; request_no: string;
}
export interface Notification { id: number; kind: string; data: Record<string, unknown>; created_at: string; read_at: string | null }
export interface Settings { adminWa: string; payoutHours: number; commission: number; withdrawMin: number; presets: number[]; loginDomain: string; confirmDeadline: string }
/** What ref.public_info() returns before login. */
export interface PublicInfo { commission: number; withdraw_min: number; payout_hours: number; confirm_deadline: string; admin_wa: string }
