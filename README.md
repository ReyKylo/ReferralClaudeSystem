# Referral Claude System

Referral Portal dan manajemen operasional harian untuk ERP Claude Kita. Referral mendaftarkan peserta, lalu tim menjadwalkan
target 20 peserta per hari, mengonfirmasi H-1 lewat WhatsApp, menandai selesai, dan mengelola komisi serta pencairan ke wallet
referral. Semuanya memakai satu database dengan ERP (Supabase, schema `ref`).

## Isi repo

- `app/`, `components/`, `lib/` berisi portal referral (Next.js, static export) untuk https://referral.tampilresmi.com:
  daftar dan masuk pakai username atau nomor WhatsApp, daftarkan peserta, lihat status, saldo dan tarik saldo lewat
  WhatsApp admin, notifikasi, dan link ajak teman. Admin dan tim operasional memakai modul Referral di ERP.
- `docs/SETUP.md` berisi langkah sekali pasang: setting Supabase Auth, domain Cloudflare, dan deploy.
- `tests/e2e/` berisi Supabase tiruan dan tes klik portal (Playwright) di layar HP dan desktop.

- `wireframe/index.html` berisi wireframe interaktif dengan tampilan CodePave. Dibuka di layar Daftar/Masuk; pilih "Lihat sebagai" untuk berganti ke portal referral, admin, atau tim operasional. Datanya contoh dan tidak tersimpan.
- `docs/PLAN.md` berisi rencana lengkap: arsitektur, peran, alur status, database, layar, fase, dan pertanyaan terbuka.
- `supabase/migrations/` berisi skema `ref` untuk semua fase. Sudah dipasang ke Supabase pada 5 Nov 2026.
- `supabase/create-referrer.sql` berisi template untuk membuat login referral.
- `tests/sql/` berisi tes database: alur penuh sebagai owner, staff, dan dua referral dengan RLS aktif.

## Tes database

```bash
PGHOST=... PGUSER=postgres tests/sql/run.sh                 # pakai stub skema ERP
ERP_DIR=../ERPClaudeKita PGHOST=... tests/sql/run.sh        # pakai migrasi ERP yang asli
```

Butuh Postgres 16 dan `psql`. Script ini membuat database `ref_test` lalu menghapusnya lagi saat dijalankan ulang.

## Portal

```bash
npm install
npm run dev:mock        # Supabase tiruan, login gipong / rahasia123
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54322 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=mock npm run dev
npm run typecheck
npm run test:e2e
```

Push ke `main` di-deploy otomatis oleh Cloudflare Workers Builds (Worker `referralclaudesystem`). Lihat `docs/SETUP.md`.
