# Workflow v2: dari daftar akun sampai komisi cair

Status: **rencana, belum dibangun**. Ditulis 5 Nov 2026 setelah audit database `ref` (live), portal
(`ReferralClaudeSystem`, PR #2), dan modul Referral di ERP (`ERPClaudeKita`, main `6afe52c`).
Dokumen ini jadi pegangan untuk yang membangun (Sonnet). Bagian 8 berisi aturan kerjanya.

---

## 0. Ringkasan alur yang diminta owner

| # | Langkah | Siapa | Di mana |
|---|---------|-------|---------|
| 1 | Referral bikin akun (username, nomor WA, password) | Referral | Portal `/masuk/` |
| 2 | Referral isi data nomor: nama pemilik, nomor WA, email, bisa hari apa | Referral | Portal `/daftar/` |
| 3 | Tim ACC nomor A, B, C, lalu menjadwalkan ke hari yang cocok | Admin | ERP Referral → Peserta, Jadwal |
| 4 | H-1: tim tinggal klik **Chat** per referral. Pesan WA sudah berisi daftar nomor besok + link konfirmasi | Admin / Ops | ERP Referral → Konfirmasi H-1 |
| 5 | Referral buka link, tandai nomor mana yang **Siap** / **Tidak bisa**. Yang siap dikerjakan besoknya, lalu ditandai Selesai | Referral, lalu Ops | Portal `/besok/`, ERP |
| 6 | Tiap nomor selesai = komisi (default **Rp75.000**, bisa beda per referral). Pembagian dengan pemilik nomor urusan referral. Tim memantau per referral | Admin | ERP Uang, Laporan; Portal Saldo |
| 7 | Halaman **Cara mulai** untuk referral baru | Semua | Portal `/mulai/` (publik) |

Istilah: di dokumen ini **nomor** = satu baris `ref.participants` (pemilik nomor + WA + email). Data model tidak
diganti namanya; hanya teks di layar (lihat keputusan K6).

---

## 1. Hasil audit: yang sudah benar dan yang salah atau belum ada

### Sudah benar (jangan dirusak)
- Daftar akun tanpa email/verifikasi; masuk pakai username atau nomor WA (`ref.register_me`, `ref.login_email`).
- Semua tulisan lewat fungsi SQL `security definer` + `ref.require_role`; tabel hanya SELECT via RLS. Referral hanya
  melihat datanya sendiri.
- Satu nomor WA / email hanya boleh satu pendaftaran hidup (unique index `where status <> 'rejected'`).
- Status nomor: `submitted → under_review → approved → scheduled → confirmation_pending → confirmed → completed`
  (+ `waiting_schedule`, `rejected`), dicatat di `participant_events`.
- Target harian (20) dengan kunci baris di `ref.schedule_days`; satu nomor hanya satu jadwal aktif.
- Komisi dibuat `pending` saat Selesai, admin verifikasi → `approved` → bisa ditarik. Tarik saldo → nomor TS →
  WA admin → admin setujui → tandai dibayar + bukti.
- Live: 1 referral, 0 nomor, 0 jadwal, 0 komisi. Perubahan di bawah aman diterapkan sekarang (tidak ada data lama
  yang harus dipindah).

### Salah atau belum ada (harus diperbaiki di v2)
| Kode | Temuan | Dampak | Perbaikan |
|------|--------|--------|-----------|
| A1 | H-1 di ERP (`RefConfirm.tsx`) chat **per pemilik nomor** ke `e.wa`, bukan ke referral | Alur langkah 4 tidak bisa dijalankan | Kelompokkan per referral, 1 tombol Chat per referral (bagian 4.1) |
| A2 | Template WA (`wa_confirm_template`) ditujukan ke pemilik nomor, 1 nama per pesan | Tidak bisa berisi "siapkan 5 nomor" | Template baru `wa_referral_h1_template` dengan daftar nomor + link |
| A3 | Komisi global Rp50.000 (`commission_per_completed`), tidak ada tarif per referral | Langkah 6 salah nominal, tidak bisa beda per akun | Default 75.000 + kolom `referrers.commission_rate` (bagian 3) |
| A4 | Referral tidak bisa konfirmasi sendiri; ops harus set satu per satu | Kerja manual 20x sehari, rawan salah | `ref.confirm_my_day` + halaman portal `/besok/` |
| A5 | Ketersediaan hanya 1 tanggal + 1 jam (`avail_date`, `avail_time`) | "Bisa hari apa aja" tidak tertampung | Kolom `avail_days smallint[]` (Sen=1 … Min=7) |
| A6 | Teks persetujuan di portal: "Peserta setuju dihubungi tim lewat WhatsApp" | Salah setelah tim menghubungi referral, bukan pemilik nomor | Ganti teks (bagian 5.2); kolom `consent_wa` tetap wajib |
| A7 | Portal menampilkan komisi dari setting global (Saldo, Cara kerja komisi) | Referral dengan tarif khusus lihat angka salah | Pakai tarif efektif referral itu |
| A8 | `ref.referrer_performance` menghitung komisi per periode dari `entered_on` nomor | Laporan bulan ini memasukkan nomor yang selesai bulan lalu / sebaliknya | Pakai `commissions.created_at` (tanggal selesai) |
| A9 | Jadwal yang sudah lewat tapi belum ditutup (masih `active`) tidak punya tempat di ERP | Nomor kemarin hilang dari pandangan, komisi tidak pernah dibuat | Daftar "Belum ditutup" di ERP Hari ini (bagian 4.4) |
| A10 | Beranda portal "Perlu perhatian" menyuruh referral mengingatkan peserta | Tidak sesuai alur baru | Ganti jadi kartu "Besok: N nomor. Konfirmasi siap" |
| A14 | Tidak ada cara mengubah `ref.settings` (komisi default, template, target) selain SQL Editor | Owner harus menyentuh database untuk ganti angka | `ref.set_setting` + panel Pengaturan referral di ERP |
| A11 | Referral buatan admin (`create_referrer`) boleh tanpa WA | Tombol Chat H-1 tidak bisa dipakai | Tampilkan "Nomor WA referral belum ada" + tombol isi; wajibkan WA di `create_referrer` |
| A12 | Portal `Gate` (`components/Shell.tsx`) menganggap halaman di luar `APP_PATHS` publik | `/besok/` akan jadi publik tanpa login kalau lupa didaftarkan | Tambah `/besok/` ke `APP_PATHS`; `/mulai/` sengaja publik |
| A13 | Belum dipasang: PR #2 belum merge, Supabase "Confirm email" masih nyala, domain belum dipasang | Portal belum bisa dipakai | Langkah owner di bagian 7 |

---

## 2. Alur lengkap v2, langkah demi langkah

### Langkah 1. Referral bikin akun
- Sudah ada. Tambahan: di `/masuk/` ada link **"Baru? Lihat cara mulai"** ke `/mulai/`.
- Pesan ajak teman (Beranda) ikut menyertakan link `/mulai/`.
- Akun langsung aktif (keputusan K5). Admin tetap bisa menonaktifkan di ERP (`ref.set_referrer_active`).

### Langkah 2. Referral isi data nomor
Form `/daftar/` (per nomor):
- **Nama pemilik nomor** (wajib)
- **Nomor WhatsApp** (wajib, 10–15 digit, unik)
- **Email** (wajib, unik)
- **Bisa hari apa** (chip Sen Sel Rab Kam Jum Sab Min + "Kapan saja"; default Kapan saja) → `avail_days`
- **Jam yang cocok** (chip Pagi/Siang/Sore/Malam, boleh kosong) → `avail_time` (sudah ada)
- **Mulai bisa tanggal** (boleh kosong) → `avail_date` (sudah ada)
- Data tambahan: ID akun, catatan (sudah ada). Tetap ada peringatan "Jangan pernah tulis password atau kode OTP".
- Persetujuan (wajib): **"Pemilik nomor sudah setuju datanya didaftarkan dan dijadwalkan lewat saya."**
- Opsional fase berikutnya: **Tambah banyak sekaligus** (tempel baris `nama, nomor, email`), tiap baris divalidasi
  dan ditampilkan hasil per baris. Tidak wajib di v2.

### Langkah 3. Tim ACC dan menjadwalkan
- ERP Referral → Peserta: daftar `Terkirim`/`Sedang dicek`, centang A B C → **Terima** atau **Tolak** + alasan
  (sudah ada: `ref.review_participants`). Referral dapat notifikasi.
- ERP Referral → Jadwal: pilih hari → daftar nomor siap dijadwalkan.
  - Tampilkan **"Bisa: Sen, Rab, Jum"** per nomor (dari `avail_days`).
  - Saring **"Cocok untuk hari ini"** (default nyala): hanya nomor yang `avail_days` kosong atau memuat hari itu, dan
    `avail_date` kosong atau ≤ hari itu.
  - Kelompokkan per referral, dengan tombol **"Pilih semua dari {referral}"**.
  - Menjadwalkan ke hari yang tidak cocok tetap boleh, tapi ada peringatan yang harus diklik.
  - Target harian tetap dicek oleh `ref.schedule_participants` (lebihi target hanya jika disengaja).
- Referral dapat notifikasi "dijadwalkan {hari} jam {jam}" (sudah ada).

### Langkah 4. H-1: tim chat referral
Layar ERP **Konfirmasi H-1** dirombak jadi **per referral** (bagian 4.1). Contoh pesan yang terbuka di WhatsApp
saat tombol **Chat Gipong** ditekan:

```
Halo Gipong, besok Jumat, 6 Nov ada 5 nomor kamu yang dijadwalkan:
1. Andi Pratama · 0813-4010-1000 · jam 13.00
2. Budi Santoso · 0813-4011-1007 · jam 13.00
3. Citra Lestari · 0813-4012-1014 · jam 13.00
4. Dewi Wijaya · 0813-4013-1021 · jam 16.00
5. Eka Kusuma · 0813-4014-1028 · jam 16.00
Tolong siapkan nomornya ya. Tandai yang siap atau tidak bisa di sini:
https://referral.tampilresmi.com/besok/
Terima kasih!
```

- Menekan Chat otomatis mencatat semua nomor referral itu untuk hari itu sebagai **Sudah dihubungi**
  (`contacted`) lewat `ref.mark_referrer_contacted`, kecuali yang sudah punya jawaban. Bisa dibatalkan (toast Undo).
- Kartu referral menampilkan: jumlah nomor, berapa siap / tidak bisa / belum jawab, kapan terakhir dichat dan oleh
  siapa.

### Langkah 5. Referral konfirmasi, lalu dikerjakan
- Portal `/besok/` (wajib login; link dari WA langsung ke sini, setelah login kembali ke `/besok/`):
  - Judul "Besok, Jumat 6 Nov: 5 nomor". Daftar nomor + jam, masing-masing dua tombol **Siap** / **Tidak bisa**.
  - Tombol cepat **"Semua siap"**. Kolom catatan opsional ("Nomor 3 baru bisa jam 15.00").
  - **Kirim konfirmasi** → `ref.confirm_my_day`. Siap → `available` (status `confirmed`). Tidak bisa →
    `unavailable` (status `waiting_schedule`, tempatnya tetap terlihat merah di ERP sampai dipindah) + notifikasi admin.
  - Bisa diubah lagi selama hari H belum lewat dan nomor belum Selesai.
  - Juga bisa pilih hari lain kalau ada jadwal lusa (tab Besok / Lusa / tanggal berikutnya yang punya jadwal).
- Kalau referral menjawab lewat chat WA saja, ops tetap bisa mengisi jawabannya di ERP (per nomor atau
  **"Semua siap"** per referral).
- Hari H: ops mengerjakan, lalu **Selesai** per nomor atau **"Semua selesai"** per referral (`ref.complete_entries`).
  Nomor yang gagal di hari H → **Tidak jadi** (= `unavailable`) → kembali ke antrean jadwal.

### Langkah 6. Komisi, pembagian, pemantauan
- Setiap nomor Selesai membuat komisi `pending` sebesar **tarif efektif referral saat itu**:
  `coalesce(referrers.commission_rate, settings.commission_per_completed)`; default diubah ke **75.000**.
- Admin mengatur tarif per referral di ERP (bagian 4.3). Perubahan berlaku untuk nomor yang selesai **setelah**
  diubah. Ada pilihan "Terapkan juga ke N komisi yang masih menunggu". Komisi yang sudah disetujui tidak berubah.
  Semua perubahan tarif masuk `ref.audit_log` (nilai lama, baru, siapa).
- Pembagian dengan pemilik nomor: urusan referral. Sistem tidak mencatatnya. Ditulis jelas di `/mulai/`.
- Verifikasi komisi dan tarik saldo: tetap seperti sekarang.
- Pemantauan per referral (ERP Laporan): nomor masuk, diterima, ditolak, dijadwalkan, siap, tidak bisa, selesai,
  tarif, komisi menunggu, komisi disetujui, sudah dibayar, saldo. Filter periode, unduh CSV.

### Langkah 7. Cara mulai
Halaman publik `/mulai/` (bagian 5.4), ditautkan dari halaman masuk, Beranda (untuk akun yang belum pernah
mendaftarkan nomor), pesan ajak teman, dan bisa disalin admin dari ERP.

---

## 3. Perubahan database (satu migrasi baru di repo referral)

File: `supabase/migrations/20261106090000_ref_workflow_v2.sql`. Semua fungsi `security definer`,
`set search_path = ''`, cek peran di baris pertama, `perform ref.audit(...)` untuk setiap perubahan.

### 3.1 Kolom dan setting
```sql
alter table ref.participants add column avail_days smallint[]
  check (avail_days is null or (avail_days <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(avail_days) between 1 and 7));
alter table ref.referrers add column commission_rate bigint check (commission_rate is null or commission_rate >= 0);
alter table ref.schedule_days ... -- tidak berubah

update ref.settings set value = '75000' where key = 'commission_per_completed';
insert into ref.settings (key, value) values
  ('wa_referral_h1_template', to_jsonb('Halo {referral}, besok {date} ada {count} nomor kamu yang dijadwalkan:\n{list}\nTolong siapkan nomornya ya. Tandai yang siap atau tidak bisa di sini:\n{link}\nTerima kasih!'::text)),
  ('portal_url', '"https://referral.tampilresmi.com"')
on conflict (key) do nothing;
```
Baris daftar (`{list}`) dibentuk di ERP: `{no}. {name} · {wa} · jam {time}` (jam pakai `fmtT`, mis. `13.00`).

### 3.2 Fungsi baru
| Fungsi | Peran | Isi |
|--------|-------|-----|
| `ref.mark_referrer_contacted(p_day date, p_referrer_id uuid) returns int` | admin, ops | Entry `active` hari itu milik referral itu dengan `confirmation = 'not_contacted'` → `contacted` (pakai logika `set_confirmation` agar status dan event ikut). Kembalikan jumlah. |
| `ref.confirm_my_day(p_day date, p_ready uuid[], p_not_ready uuid[], p_note text default null) returns jsonb` | referral | Entry harus milik referral pemanggil (`participants.referrer_id = ref.my_referrer_id()`), `state = 'active'`, `day >= erp.today()`. Id yang bukan miliknya → error 42501 (jangan diam-diam dilewati). Siap → `available`, Tidak bisa → `unavailable`. Catatan masuk `ops_notes` dengan awalan "Dari referral:". Notifikasi admin `referral_confirmed` (ringkasan) dan `participant_unavailable` per nomor yang tidak bisa. Kembalikan `{ready, not_ready}`. |
| `ref.set_referrer_rate(p_referrer_id uuid, p_rate bigint, p_apply_pending boolean default false) returns int` | admin | `p_rate null` = ikut default. Simpan, audit nilai lama/baru. Kalau `p_apply_pending`, ubah `amount` komisi `pending` referral itu. Kembalikan jumlah komisi yang diubah. Notifikasi referral `rate_changed`. |
| `ref.complete_entries(p_ids uuid[], p_note text default null) returns int` | admin, ops | Loop `ref.complete_entry` (bulk "Semua selesai"). |
| `ref.set_setting(p_key text, p_value jsonb) returns void` | admin | Hanya kunci yang diizinkan: `commission_per_completed`, `wa_referral_h1_template`, `daily_target`, `withdraw_min`, `withdraw_presets`, `admin_wa`, `payout_hours`. Validasi tipe dan rentang per kunci. Audit nilai lama/baru. |
| `ref.bulk_confirm(p_day date, p_referrer_id uuid, p_status ref.confirmation_status) returns int` | admin, ops | "Semua siap" per referral dari ERP saat referral menjawab lewat chat. |

### 3.3 Fungsi yang diubah
- `ref.submit_participant` dan `ref.update_my_participant`: tambah parameter `p_avail_days smallint[] default null`.
  **Drop dulu** fungsi lama sebelum membuat yang baru (PostgREST bingung kalau ada dua overload), lalu ulangi
  `grant execute ... to authenticated`.
- `ref.complete_entry`: nominal komisi = tarif efektif referral (lihat langkah 6).
- `ref.create_referrer`: `p_wa` wajib dan divalidasi 10–15 digit (A11).
- `ref.referrer_performance`: tambah kolom `rate`, `scheduled`, `ready`, `not_ready`, `pending_commission`,
  `approved_commission`, `available`; komisi per periode berdasarkan `commissions.created_at` di WIB (A8).

### 3.4 View
- `ref.participant_overview`: tambah `avail_days` dan (sudah ada) `entry_id`.
- `ref.entry_overview`: tambah `referrer_wa`, `avail_days`, `confirmation_at`, `confirmation_by_name`.
- View baru `ref.referrer_overview` (admin saja via RLS yang ada): id, name, username, wa, active, commission_rate,
  effective_rate, jumlah nomor per status, saldo. Dipakai ERP Uang & Laporan.
- Referral boleh membaca `commission_rate` baris dirinya (sudah lewat RLS referrers). Tidak ada jalur menulis.

### 3.5 Tes SQL (`tests/sql/`)
Tambah `30_workflow_v2.sql`:
1. Referral A daftar 3 nomor dengan `avail_days`; admin terima; jadwalkan besok.
2. Ops `mark_referrer_contacted` → 3 entry `contacted`, status `confirmation_pending`.
3. Referral A `confirm_my_day` 2 siap, 1 tidak bisa → status `confirmed`, `confirmed`, `waiting_schedule`;
   admin dapat notifikasi.
4. Referral B memanggil `confirm_my_day` dengan entry milik A → ditolak 42501.
5. Admin set tarif A = 100.000 → selesai 1 nomor → komisi 100.000; referral B tetap 75.000.
6. `set_referrer_rate(..., apply_pending => true)` mengubah komisi pending saja, bukan yang approved.
7. Referral tidak bisa memanggil `set_referrer_rate`, `set_setting`, `mark_referrer_contacted`, `bulk_confirm`,
   `complete_entries`. `set_setting` menolak kunci di luar daftar.
8. `referrer_performance` menghitung komisi berdasarkan tanggal selesai.

---

## 4. Perubahan ERP (`ERPClaudeKita`)

File utama: `components/referral/*.tsx`, `lib/ref/{queries,actions,types}.ts`, `messages/id.json` dan
`messages/zh-CN.json` (**setiap teks baru wajib ada di dua bahasa**), `tests/e2e/mock-ref.mjs`,
`tests/e2e/referral.spec.ts`.

### 4.1 Konfirmasi H-1 per referral (`RefConfirm.tsx`)
- Pemilih hari tetap (Hari ini / Besok / Lusa), default Besok. KPI tetap.
- Isi: satu kartu per referral, diurutkan: ada yang belum dijawab dulu, lalu nama.
  - Kepala kartu: nama referral, nomor WA, "5 nomor · 3 siap · 1 tidak bisa · 1 belum jawab",
    "Dichat 10.15 oleh Rina".
  - Tombol utama **Chat {referral}** (`waLink(referrer_wa, pesan)`), lalu panggil `mark_referrer_contacted`.
    Kalau referral tidak punya WA: teks "Nomor WA referral belum ada" + link ke data referral.
  - Tombol kedua **Semua siap** (`bulk_confirm available`), dan pada hari H **Semua selesai** (`complete_entries`).
  - Di bawahnya daftar nomor (bisa dilipat): nama, nomor, jam, jawaban (Siap / Tidak bisa / Belum jawab / Sudah
    dihubungi), tombol per nomor yang sudah ada (jawaban, catatan, Selesai). Chat langsung ke pemilik nomor
    hanya ada di menu "Lainnya" (cadangan, K1).
- Nomor yang ditandai Tidak bisa oleh referral muncul dengan catatan referral dan tombol **Pindah jadwal**.

### 4.2 Jadwal (`RefSchedule.tsx`)
Lihat langkah 3: tampilkan `avail_days`, saring "Cocok untuk hari ini", kelompok per referral, pilih semua per
referral, peringatan kalau hari tidak cocok.

### 4.3 Tarif per referral (`RefMoney.tsx`, tab Referral)
- Kolom **Komisi per nomor**: "Rp75.000 (default)" atau "Rp100.000 (khusus)". Tombol **Ubah** → isian nominal +
  pilihan "Ikuti default" + centang "Terapkan juga ke N komisi yang masih menunggu" → `set_referrer_rate`.
- Hanya role admin (owner/admin). Staff/ops melihat tanpa tombol Ubah.
- Default global diubah di panel baru **Pengaturan referral** (admin saja) lewat `ref.set_setting`: komisi default
  per nomor, template WA H-1, target harian default, minimal tarik saldo, WA admin. Teks di samping komisi default:
  "Berlaku untuk referral tanpa tarif khusus". Saat ini belum ada cara mengubah setting selain SQL.

### 4.4 Hari ini (`RefToday.tsx`)
- Tambah bagian **Belum ditutup**: entry `active` dengan `day < today`. Tombol Selesai / Tidak jadi per baris
  dan per referral (A9).

### 4.5 Laporan (`RefReport.tsx`)
- Tabel per referral dari `referrer_performance` versi baru + unduh CSV. Klik referral → daftar nomornya.

### 4.6 Link Cara mulai
- Di ERP Referral (kepala halaman Peserta atau Uang): tombol **Salin link cara mulai** →
  `https://referral.tampilresmi.com/mulai/`.

---

## 5. Perubahan portal (`ReferralClaudeSystem`)

File utama: `app/*/page.tsx`, `components/Shell.tsx`, `lib/{data,actions,status,types,format}.ts`,
`tests/e2e/mock-supabase.mjs`, `tests/e2e/portal.spec.ts`.

### 5.1 Data
- `useMe`: ambil `commission_rate`; `useSettings` sudah punya `commission` → tarif efektif =
  `me.commission_rate ?? settings.commission`. Satu helper `useRate()`, dipakai di semua teks nominal (A7).
- `P_COLS` tambah `avail_days`, `entry_id`.
- Action baru: `confirmMyDay(day, ready, notReady, note)`.

### 5.2 Daftarkan nomor (`app/daftar/page.tsx`)
- Field "Bisa hari apa" (chip, multi; "Kapan saja" = kosong). Teks persetujuan baru (A6).
- Mode perbaiki (`?fix=`) ikut mengisi `avail_days`.

### 5.3 Besok (`app/besok/page.tsx`, baru, wajib login)
- Lihat langkah 5. Tambah `/besok/` ke `APP_PATHS` di `Shell.tsx` (A12). Kalau belum login, `/masuk/` harus
  mengembalikan ke `/besok/` setelah masuk (simpan `?next=/besok/`, hanya izinkan path internal yang diawali `/`).
- Kosong: "Belum ada nomor yang dijadwalkan besok. Anda dapat notifikasi saat tim menjadwalkan."
- Beranda: kartu **"Besok: 5 nomor. 2 belum dikonfirmasi"** → `/besok/` menggantikan kartu "Ingatkan" (A10).
- Menu bawah tetap 4 item; Besok diakses dari Beranda dan link WA (tidak menambah tab).

### 5.4 Cara mulai (`app/mulai/page.tsx`, baru, publik)
Isi (bahasa awam, pendek, pakai "jalan" CodePave 4 langkah sebagai gambar):
1. **Buat akun.** Cukup username, nomor WhatsApp, dan password. Tidak perlu email.
2. **Daftarkan nomor.** Isi nama pemilik, nomor WhatsApp, email, dan hari yang bisa. Pastikan pemiliknya sudah setuju.
3. **Tunggu dicek.** Tim mengecek dan menerima nomor. Kalau ditolak, alasannya muncul dan Anda bisa memperbaiki.
4. **Dijadwalkan.** Anda dapat notifikasi hari dan jamnya.
5. **H-1, siapkan nomornya.** Tim mengirim WhatsApp berisi daftar nomor besok. Buka linknya, tandai **Siap** atau
   **Tidak bisa**.
6. **Selesai, komisi masuk.** Setiap nomor yang selesai: **Rp75.000** (atau tarif khusus Anda). Setelah dicek tim,
   masuk saldo.
7. **Tarik saldo.** Mulai Rp50.000. Kirim detailnya ke WhatsApp admin. Uang masuk paling lambat 1x24 jam.

Kotak "Penting":
- Pembagian komisi dengan pemilik nomor Anda atur sendiri.
- Jangan pernah tulis atau kirim password dan kode OTP lewat portal.
- Satu nomor WhatsApp atau email hanya bisa didaftarkan sekali.

Tanya jawab singkat: kenapa ditolak, kalau nomor tidak bisa besok, kapan komisi masuk, lupa password (chat admin).
Tombol: **Buat akun** (ke `/masuk/`), **Chat admin**. Nominal di halaman publik diambil dari setting default
(tanpa login); di dalam portal pakai tarif efektif.

### 5.5 Lain-lain
- `lib/status.ts`: notifikasi baru `rate_changed` ("Komisi per nomor Anda sekarang Rp100.000").
- Saldo → "Cara kerja komisi": nominal dari `useRate()`.
- Pesan ajak teman: tambah link `/mulai/`.
- Teks "peserta" → "nomor" sesuai keputusan K6.

---

## 6. Tes yang harus lolos sebelum PR dianggap selesai

### Portal (`npm run test:e2e`, HP + desktop)
- Daftar nomor dengan hari Sen+Rab; muncul di daftar dengan "Bisa: Sen, Rab".
- Buka `/besok/` tanpa login → `/masuk/` → setelah login kembali ke `/besok/`.
- Tandai 2 siap 1 tidak bisa → status di daftar berubah; ubah lagi bisa.
- Referral dengan tarif khusus melihat nominal itu di Saldo dan Cara kerja komisi.
- `/mulai/` terbuka tanpa login dan menampilkan Rp75.000.
- Semua tes lama tetap lolos.

### ERP (`npm run test:e2e` dengan `E2E_PROD=1`)
- H-1 menampilkan 1 kartu per referral; link Chat berisi daftar nomor, jam, dan link `/besok/`; setelah klik,
  status jadi Sudah dihubungi; Undo mengembalikan.
- Semua siap / Semua selesai per referral.
- Jawaban dari portal (mock) tampil di ERP.
- Ubah tarif referral (admin) → komisi berikutnya pakai tarif itu; staff tidak melihat tombol Ubah.
- Jadwal: saring "Cocok untuk hari ini" sesuai `avail_days`.
- Belum ditutup tampil untuk jadwal kemarin.
- Teks baru ada di `id.json` dan `zh-CN.json` (tes kunci i18n yang sudah ada harus lolos).

### Database: `tests/sql/run.sh` (stub dan `ERP_DIR` asli) lolos, termasuk `30_workflow_v2.sql`.

---

## 7. Urutan kerja

0. **Owner** (sebelum build): merge PR #2 portal; Supabase "Confirm email" OFF dan "Allow new users to sign up" ON;
   default branch `main`; pasang domain `referral.tampilresmi.com`. (Panduan: `docs/SETUP.md`.)
1. **Database**: migrasi v2 + tes SQL. Belum dipasang ke live.
2. **Portal**: 5.1 → 5.5 + mock + e2e. PR draft di `ReyKylo/ReferralClaudeSystem`.
3. **ERP**: 4.1 → 4.6 + i18n + mock + e2e. PR draft di `ReyKylo/ERPClaudeKita`.
4. **Pasang migrasi ke Supabase live** hanya setelah owner setuju (sebutkan isinya), lalu cek
   `get_advisors` (security) tidak ada temuan baru di schema `ref`.
5. Merge ERP dan portal setelah migrasi live terpasang (portal/ERP baru memanggil fungsi baru).

---

## 8. Aturan untuk yang membangun

- Semua tulisan lewat fungsi SQL dengan `ref.require_role`. Jangan menambah policy INSERT/UPDATE/DELETE di tabel.
  `anon` hanya boleh `signup_available` dan `login_email`.
- Jangan pernah menaruh service_role / secret key di repo atau env file. Repo referral publik. Jangan commit data
  nomor asli.
- Tampilan CodePave (token di `app/globals.css` portal dan `styles/app.css` ERP): teks di atas oranye selalu
  Asphalt, radius 4px, garis putus-putus, font Overpass. Ikuti komponen yang sudah ada (`Field`, `Badge`, `Road`,
  `cp-*`).
- Bahasa layar: Indonesia awam, kalimat pendek, tanpa istilah teknis. Pesan error yang bisa ditindaklanjuti.
- Ringan untuk Supabase: TanStack Query, `staleTime` 60 detik, tanpa polling, paging 50.
- Jangan ubah nama tabel/kolom yang sudah ada. Tambah saja.
- Jalankan typecheck, build, e2e, dan tes SQL sebelum push. Jangan skip/disable tes.

---

## 9. Keputusan yang perlu dikonfirmasi owner (default dipakai kalau tidak ada jawaban)

| Kode | Pertanyaan | Default |
|------|------------|---------|
| K1 | H-1 hanya chat ke **referral**? Chat langsung ke pemilik nomor masih perlu? | Hanya referral; chat pemilik nomor disembunyikan di menu "Lainnya" sebagai cadangan |
| K2 | Referral konfirmasi lewat link portal, dan tim juga bisa isi manual dari balasan WA? | Ya, dua-duanya |
| K3 | "Bisa hari apa" = pilihan hari Senin–Minggu? | Ya, plus "Kapan saja" dan "Mulai bisa tanggal" |
| K4 | Rp75.000 per nomor yang **selesai**; tarif baru hanya untuk nomor yang selesai setelah diubah? | Ya, dengan opsi terapkan ke komisi yang masih menunggu |
| K5 | Akun referral langsung aktif tanpa ACC? | Ya (sesuai "siapapun bisa"); admin bisa menonaktifkan |
| K6 | Di layar, sebut "nomor" atau "peserta"? | "Nomor" di portal dan modul Referral ERP |
| K7 | Ada batas jam konfirmasi H-1 (mis. sampai 21.00)? | Tidak dikunci; ERP menandai yang belum menjawab |
| K8 | Ada batas maksimal nomor per referral per hari? | Tidak; hanya target harian total (20) |
