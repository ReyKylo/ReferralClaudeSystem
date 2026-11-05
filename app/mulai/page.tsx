'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/ui';
import { usePublicInfo } from '@/lib/data';
import { fmtDeadline, rp, waLink } from '@/lib/format';
import { supabase } from '@/lib/supabase';

/** Open to everyone (no account needed): how to start as a referral. Numbers come from ref.public_info(). */
export default function Mulai() {
  const info = usePublicInfo().data;
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { supabase().auth.getSession().then(({ data }) => setSignedIn(!!data.session)).catch(() => undefined); }, []);

  const commission = rp(info?.commission ?? 75000);
  const min = rp(info?.withdraw_min ?? 50000);
  const hours = info?.payout_hours ?? 24;
  const deadline = fmtDeadline(info?.confirm_deadline ?? '21:00');
  const adminWa = info?.admin_wa ?? '6281299323591';

  const steps: Array<[string, string]> = [
    ['Buat akun', 'Cukup nama pengguna, nomor WhatsApp, dan password. Tidak perlu email dan tidak ada kode verifikasi.'],
    ['Daftarkan nomor', 'Isi nama pemilik nomor, nomor WhatsApp, email, password akunnya, dan hari yang bisa. Pastikan pemiliknya sudah setuju. Password disimpan terenkripsi, hanya tim yang bisa membukanya.'],
    ['Tunggu dicek', 'Tim mengecek dan menerima nomornya. Kalau ditolak, alasannya muncul dan Anda bisa memperbaiki lalu kirim lagi.'],
    ['Dapat jadwal', 'Anda dapat notifikasi hari dan jamnya.'],
    ['Sehari sebelumnya, siapkan nomornya', `Tim mengirim WhatsApp berisi daftar nomor besok. Kabari pemilik nomornya, lalu buka link di pesan itu dan tandai Siap atau Tidak bisa paling lambat jam ${deadline}.`],
    ['Selesai, komisi masuk', `Setiap nomor yang selesai memberi komisi ${commission} (atau tarif khusus Anda). Setelah dicek tim, komisinya masuk saldo.`],
    ['Tarik saldo', `Saldo bisa ditarik mulai ${min}. Isi rekening atau e-wallet, lalu kirim detailnya ke WhatsApp admin. Uang masuk paling lambat 1x${hours} jam.`],
  ];

  return (
    <div className="center-page">
      <div style={{ width: 'min(640px, 100%)' }} className="grid">
        <div className="brand-top"><Logo /></div>
        <section className="card card-pad grid" style={{ gap: 'var(--s5)' }}>
          <div className="grid" style={{ gap: 'var(--s2)' }}>
            <h1>Cara mulai jadi referral</h1>
            <p className="muted">Daftarkan nomor, tim yang menjadwalkan dan mengerjakan. Anda dapat komisi untuk setiap nomor yang selesai.</p>
          </div>
          <ol className="steps">
            {steps.map(([title, text], i) => (
              <li key={title}><span className="step-no num" aria-hidden="true">{i + 1}</span><div><b>{title}</b><p className="meta-t">{text}</p></div></li>
            ))}
          </ol>
          <div className="note ic"><Icon id="i-alert" /><div>
            <b>Penting</b>
            <ul className="plain">
              <li>Pembagian komisi dengan pemilik nomor Anda atur sendiri.</li>
              <li>Jangan pernah menulis kode OTP di portal. Kode OTP hanya dikirim lewat chat saat tim memintanya.</li>
              <li>Satu nomor WhatsApp atau email hanya bisa didaftarkan sekali.</li>
            </ul>
          </div></div>
          <div className="head-actions">
            {signedIn ? <Link className="btn btn-1" href="/">Kembali ke Beranda</Link> : <Link className="btn btn-1" href="/masuk/">Buat akun</Link>}
            <a className="btn wa" href={waLink(adminWa, 'Halo admin, saya mau tanya soal jadi referral.')} target="_blank" rel="noopener noreferrer"><Icon id="i-chat" />Chat admin</a>
          </div>
        </section>

        <section className="grid" style={{ gap: 'var(--s2)' }}>
          <h2>Pertanyaan yang sering muncul</h2>
          <details className="more"><summary>Kenapa nomor saya ditolak?</summary><div><p>Alasannya ditulis di halaman Nomor. Yang paling sering: nomor WhatsApp tidak aktif, atau nomor atau email itu sudah didaftarkan orang lain. Ganti datanya, isi password lagi, lalu kirim ulang.</p></div></details>
          <details className="more"><summary>Bagaimana kalau nomornya tidak bisa besok?</summary><div><p>Tandai Tidak bisa sebelum jam {deadline}. Nomornya kembali ke antrean dan tim mencarikan jadwal baru.</p></div></details>
          <details className="more"><summary>Kapan komisi masuk saldo?</summary><div><p>Setelah nomornya selesai dikerjakan dan dicek tim. Anda dapat notifikasi saat komisinya masuk.</p></div></details>
          <details className="more"><summary>Saya lupa password.</summary><div><p>Chat admin di WhatsApp dan sebutkan nomor WhatsApp Anda. Admin akan membuatkan password baru.</p></div></details>
        </section>
      </div>
    </div>
  );
}
