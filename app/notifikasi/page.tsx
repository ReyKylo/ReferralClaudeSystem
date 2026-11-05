'use client';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Empty, Icon, Skeleton, useToast } from '@/components/ui';
import { markNotificationsRead } from '@/lib/actions';
import { refreshAll, useNotifications } from '@/lib/data';
import { rel } from '@/lib/format';
import { notifText } from '@/lib/status';
import { errText } from '@/lib/supabase';
import type { Notification } from '@/lib/types';

export default function Notifikasi() {
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useNotifications();
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read_at).length;
  const open = async (n: Notification) => {
    if (!n.read_at) { try { await markNotificationsRead([n.id]); await refreshAll(qc); } catch { /* reading still works */ } }
    router.push(notifText(n).to);
  };
  const readAll = async () => { try { await markNotificationsRead(null); await refreshAll(qc); } catch (e) { toast(errText(e), true); } };
  return (
    <>
      <div className="head">
        <div><h1>Notifikasi</h1><p>{unread ? `${unread} belum dibaca.` : 'Semua sudah dibaca.'}</p></div>
        {unread > 0 && <div className="head-actions"><button type="button" className="btn btn-3" onClick={readAll}>Tandai semua dibaca</button></div>}
      </div>
      <section className="card">
        {list.isLoading ? <Skeleton /> : items.length ? (
          <div className="list">
            {items.map((n) => (
              <button type="button" className="row" key={n.id} onClick={() => open(n)}>
                <div className="prow"><span style={{ fontWeight: n.read_at ? 400 : 600 }}>{notifText(n).text}</span><span className="meta-t">{rel(n.created_at.slice(0, 10))}</span></div>
                {n.read_at ? <Icon id="i-chev" className="go" /> : <Badge tone="warn">Baru</Badge>}
              </button>
            ))}
          </div>
        ) : <Empty icon="i-bell">Belum ada notifikasi. Kabar soal nomor dan saldo Anda akan muncul di sini.</Empty>}
      </section>
    </>
  );
}
