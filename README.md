# Referral Claude System

Referral Portal dan manajemen operasional harian untuk ERP Claude Kita. Referral mendaftarkan peserta, lalu tim menjadwalkan
target 20 peserta per hari, mengonfirmasi H-1 lewat WhatsApp, menandai selesai, dan mengelola komisi serta pencairan ke wallet
referral. Semuanya memakai satu database dengan ERP (Supabase, schema `ref`).

## Isi repo

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
