'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { REFST, STEPS, type Tone } from '@/lib/status';
import type { Participant } from '@/lib/types';

/* ---------- icons: one Lucide set, 20/24 px, stroke 2 (sprite in Icons) ---------- */
export function Icons() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-home" viewBox="0 0 24 24"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></symbol>
      <symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></symbol>
      <symbol id="i-wallet" viewBox="0 0 24 24"><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></symbol>
      <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></symbol>
      <symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14" /><path d="M12 5v14" /></symbol>
      <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></symbol>
      <symbol id="i-chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></symbol>
      <symbol id="i-chat" viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></symbol>
      <symbol id="i-alert" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></symbol>
      <symbol id="i-wifi-off" viewBox="0 0 24 24"><path d="M12 20h.01" /><path d="M8.5 16.43a5 5 0 0 1 7 0" /><path d="M2 8.82a15 15 0 0 1 4.17-2.65" /><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" /><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" /><path d="M5 12.86a10 10 0 0 1 5.17-2.69" /><path d="m2 2 20 20" /></symbol>
    </svg>
  );
}
export const Icon = ({ id, className = '' }: { id: string; className?: string }) => (
  <svg className={`ico ${className}`} aria-hidden="true"><use href={`#${id}`} /></svg>
);

export const Badge = ({ tone, children }: { tone: Tone; children: React.ReactNode }) => <span className={`badge b-${tone}`}>{children}</span>;
export const PBadge = ({ p }: { p: Participant }) => <Badge tone={REFST[p.status].tone}>{REFST[p.status].label}</Badge>;

/** The paving road: done blocks are asphalt, the current one is Cone Orange, the rest are empty. */
export function Road({ p, labels = false }: { p: Participant; labels?: boolean }) {
  const now = REFST[p.status].now, bad = p.status === 'rejected';
  return (
    <div>
      <div className={`road${bad ? ' bad' : ''}`} role="img" aria-label={`Tahap ${Math.min(now + 1, 4)} dari 4: ${REFST[p.status].label}`}>
        {STEPS.map((s, i) => <i key={s} className={i < now ? 'done' : i === now ? 'now' : ''} />)}
      </div>
      {labels && <div className="road-steps">{STEPS.map((s, i) => <span key={s} className={i === now ? 'now' : ''}>{i === now && bad ? 'Ditolak' : s}</span>)}</div>}
    </div>
  );
}

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string; help?: string; error?: string; ok?: boolean; optional?: boolean; after?: React.ReactNode; textarea?: boolean;
}
/** Label, input, and one line under it: the error (red), a confirmation (green) or the help text. */
export function Field({ id, label, help, error, ok, optional, after, textarea, ...rest }: FieldProps) {
  const msg = error || help;
  const desc = msg ? `${id}-h` : undefined;
  const control = textarea
    ? <textarea className="input" id={id} aria-describedby={desc} value={rest.value as string} onChange={rest.onChange as unknown as React.ChangeEventHandler<HTMLTextAreaElement>} />
    : <input className="input" id={id} aria-invalid={error ? true : undefined} aria-describedby={desc} {...rest} />;
  return (
    <div className="field">
      <label htmlFor={id}>{label}{optional && <span className="opt"> (boleh kosong)</span>}</label>
      {after ? <div className="pw">{control}{after}</div> : control}
      {msg && <span className={`help${error ? ' bad' : ok ? ' ok' : ''}`} id={desc}>{msg}</span>}
    </div>
  );
}

/* ---------- toast ---------- */
type Show = (text: string, err?: boolean) => void;
const ToastCtx = createContext<Show>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ text: string; err?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback<Show>((text, err) => { clearTimeout(timer.current); setT({ text, err }); timer.current = setTimeout(() => setT(null), 3500); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && <div className={`toast${t.err ? ' err' : ''}`} role="status"><span>{t.text}</span></div>}
    </ToastCtx.Provider>
  );
}

/** "Mengirim…" for at least 500 ms so a tap is always acknowledged. */
export async function withBusy<T>(set: (b: boolean) => void, fn: () => Promise<T>): Promise<T> {
  set(true);
  const started = Date.now();
  try { return await fn(); } finally { const left = 500 - (Date.now() - started); if (left > 0) await new Promise((r) => setTimeout(r, left)); set(false); }
}

/** Shows a banner while the phone is offline. */
export function useOnline() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const up = () => setOn(navigator.onLine);
    up(); window.addEventListener('online', up); window.addEventListener('offline', up);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', up); };
  }, []);
  return on;
}

export function Empty({ icon = 'i-users', title, children }: { icon?: string; title?: string; children: React.ReactNode }) {
  return <div className="empty"><Icon id={icon} />{title && <b>{title}</b>}<span>{children}</span></div>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div aria-busy="true" aria-label="Memuat">{Array.from({ length: rows }, (_, i) => <div key={i} className="row" style={{ background: 'var(--surface-2)', minHeight: 64 }} />)}</div>;
}
