'use client';

import Link from 'next/link';
import { refLine } from '@/lib/status';
import type { Commission, Participant } from '@/lib/types';
import { Icon, PBadge, Road } from './ui';

/** A participant row: name + status, one plain sentence, and the paving road. Opens the detail. */
export function PRow({ p, c }: { p: Participant; c?: Commission | null }) {
  return (
    <Link className="row" href={`/peserta/?id=${p.id}`}>
      <div className="prow">
        <div className="prow-top"><b>{p.name}</b><PBadge p={p} /></div>
        <span className="line-t">{refLine(p, c)}</span>
        <Road p={p} />
      </div>
      <Icon id="i-chev" className="go" />
    </Link>
  );
}
