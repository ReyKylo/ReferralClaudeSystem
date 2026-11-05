# Rencana build Referral Claude System

Dokumen ini menerjemahkan PRD *Referral Management & Daily Operations System* menjadi rencana yang bisa langsung dikerjakan.
Status: **fondasi database selesai dan sudah dites** (`supabase/migrations/20261104120000_ref_init.sql`, tes di `tests/sql/`).
Migrasinya **sudah dipasang** ke Supabase (project `vfttmslrjimbndseqqko`, 5 Nov 2026). Wireframe interaktif ada di `wireframe/index.html` (buka langsung di browser).

Prinsip PRD: *One Referral Portal. One Central Database. One Internal ERP.*

---

## 1. Arsitektur

| Bagian | Tempat | Isi |
|---|---|---|
| Database | Supabase project yang sama dengan ERP (`vfttmslrjimbndseqqko`), schema baru **`ref`** | Satu database untuk portal dan ERP. Data yang diinput referral langsung terlihat di ERP tanpa proses sinkronisasi. |
| Referral Portal (eksternal) | **Repo ini**, aplikasi Next.js 15 terpisah (stack sama dengan ERP) | Login referral, daftar peserta, status, jadwal, wallet, pencairan, notifikasi |
| Layar internal (admin + operasional) | **Repo ERPClaudeKita**, menu baru "Referral" | Review peserta, kalender jadwal dan target, konfirmasi H-1, dashboard harian, komisi, pencairan, laporan |

Kenapa layar internal masuk ke ERP: admin dan tim sudah login di sana, perannya (owner/admin/staff) sudah ada, dan PRD meminta
satu ERP. Kenapa portal dipisah: referral orang luar. Mereka tidak boleh punya akses ke kode atau layar ERP, dan portalnya bisa
dibuat jauh lebih sederhana.

**Real-time.** Karena portal dan ERP membaca database yang sama, data yang baru disimpan langsung terlihat di layar mana pun yang
dimuat ulang. Mengikuti aturan "ringan di Supabase" milik ERP, tidak ada polling dan Realtime. Layar memuat ulang datanya saat
dibuka, setelah menyimpan, atau saat tombol muat ulang ditekan (TanStack Query, `staleTime` 60 detik).

## 2. Peran dan akses

| Peran PRD | Diambil dari | Bisa |
|---|---|---|
| Admin | `erp.profiles.role` = `owner` atau `admin` | Semua. Review, jadwal, target, komisi, pencairan, laporan, audit log |
| Operations Team | `erp.profiles.role` = `staff` | Melihat peserta yang ada di jadwal beserta kontaknya, konfirmasi H-1, catatan, menandai selesai |
| Referral | Baris di `ref.referrers` yang terhubung ke login. **Siapa pun bisa daftar sendiri** di portal (bagian 2b) | Hanya data miliknya: daftar peserta, status, jadwal, wallet, pencairan, notifikasi |

### 2b. Daftar dan masuk (referral)

Keputusan owner: daftar harus gampang. Siapa pun bisa, tanpa email dan tanpa verifikasi.

| Layar | Isi |
|---|---|
| Daftar | **Username**, **Nomor WhatsApp**, **Password** (minimal 6). Tombol "Daftar & masuk", setelah itu langsung masuk ke portal |
| Masuk | Username + password |
| Lupa password | Chat admin lewat WhatsApp; admin membuatkan password baru |

Cara kerjanya (`supabase/migrations/20261104130000_ref_self_signup.sql`):
1. Supabase Auth butuh email, jadi portal membuat alamat login dari username: `<username>@referral.tampilresmi.com`.
   Alamat ini tidak pernah menerima email dan tidak terlihat oleh pengguna.
2. "Confirm email" dimatikan, sehingga `signUp()` langsung membuat sesi login.
3. Portal memanggil `ref.register_me(username, nomor)`, yang menjadikan login itu referral aktif.
   Username dan nomor WA harus unik, dan login tim ERP ditolak.
4. Saat mengetik, form mengecek username dan nomor lewat `ref.signup_available()`. Hanya fungsi ini yang bisa dipanggil sebelum login.
5. Admin mendapat notifikasi "referral baru" dan bisa menonaktifkan referral (`ref.set_referrer_active`).

- Referral **tidak pernah** punya baris di `erp.profiles`, sehingga RLS ERP tetap menyembunyikan semua data ERP dari mereka (sudah dites).
- Setiap tulis lewat fungsi SQL `security definer` yang memeriksa peran. Tabel hanya punya policy baca, jadi status, jadwal,
  komisi, dan saldo tidak bisa diubah lewat API secara langsung (dites: `insert`/`update` langsung ditolak).
- Ops tidak bisa melihat komisi, pencairan, atau peserta yang belum dijadwalkan. Referral tidak bisa melihat catatan internal
  (`ref.ops_notes`) maupun riwayat konfirmasi.

## 3. Alur status

### Peserta (`ref.participant_status`)

```
Submitted ─review─▶ Under Review ─approve─▶ Approved ─jadwalkan─▶ Scheduled
    │                    │                                          │ H-1: contacted / waiting
    └──────reject────────┴──▶ Rejected (dengan alasan)               ▼
                                                           Confirmation Pending
                                                    available │           │ unavailable / reschedule
                                                              ▼           ▼
                                                         Confirmed   Waiting for Schedule ─jadwalkan ulang─▶ Scheduled
                                                              │ selesai
                                                              ▼
                                                          Completed ─▶ komisi Pending ─verifikasi admin─▶ Approved
```

Setiap perubahan status otomatis tercatat di `ref.participant_events` lewat trigger.

### Konfirmasi H-1 (`ref.confirmation_status`)

`Not Contacted → Contacted → Waiting for Response → Available | Unavailable | Reschedule Required`

### Tempat di jadwal (`ref.schedule_entries.state`)

`active` (memegang tempat), `moved` (dipindah, menunjuk ke entri barunya), `cancelled`, `completed`.
Satu peserta hanya bisa memegang **satu tempat aktif**, dijaga unique index. Karena itu peserta tidak mungkin terjadwal dua kali
di waktu yang bertabrakan.

## 4. Database (schema `ref`)

| Tabel | Isi |
|---|---|
| `settings` | `daily_target` (20), `commission_per_completed` (50.000), `withdraw_presets`, `withdraw_min` (50.000), `wa_confirm_template` |
| `referrers` | Referral: nama, WA, login, rekening pencairan |
| `participants` | Data peserta dari PRD bagian 3, `consent_wa` wajib, status, alasan tolak, link opsional ke `erp.accounts` |
| `participant_events` | Riwayat status, jadwal, konfirmasi, catatan |
| `ops_notes` | Catatan internal tim (tidak terlihat referral) |
| `schedule_days` | Target per tanggal (kalau berbeda dari 20) |
| `schedule_entries` | Tempat peserta di sebuah tanggal + jam + hasil konfirmasi H-1 |
| `commissions` | Satu komisi per peserta selesai: `pending` → `approved` / `void` |
| `withdrawals` | Permintaan pencairan: `requested` → `approved` → `paid` (atau `rejected` / `cancelled`) |
| `notifications` | Notifikasi per user (PRD bagian 9) |
| `audit_log` | Jejak semua aksi admin/tim/referral |

**Aturan penting yang dijaga di server (semuanya dites):**

| Aturan PRD | Cara |
|---|---|
| Duplicate registration | WA (dinormalisasi: 0812…, +62 812…, 812…) dan email unik di antara pendaftaran yang tidak ditolak, untuk semua referral |
| Tidak boleh dijadwalkan dua kali | Satu tempat `active` per peserta (unique index); jadwal baru = pindah |
| Target harian | Menjadwalkan melebihi target ditolak kecuali admin sengaja memilih "lebihi target"; tanggal dikunci saat diisi supaya dua admin tidak bisa mengisi melebihi target bersamaan |
| Komisi setelah verifikasi | Komisi dibuat `pending` saat ditandai selesai, dan baru masuk saldo setelah admin memverifikasi |
| Hold saldo, tanpa double withdrawal | Saldo tersedia = komisi approved − (requested + approved + paid). Permintaan dicek di bawah row lock milik referral |
| Paid hanya setelah benar-benar dibayar | `paid` hanya dari `approved` dan wajib ada nomor referensi transfer atau bukti upload |
| Bukti pembayaran | Bucket Storage privat `ref-payment-proofs/<referrer_id>/…`. Admin mengunggah, referral hanya bisa membaca foldernya sendiri |
| Kredensial | Portal **tidak** meminta password apa pun. "Cloud Account Reference" hanya ID/label |
| Persetujuan dihubungi | `consent_wa` wajib dicentang saat mendaftar |

**Fungsi (RPC):** `submit_participant`, `update_my_participant`, `review_participants`, `add_ops_note`, `set_day_target`,
`schedule_participants`, `unschedule`, `set_confirmation`, `complete_entry`, `set_commission_amount`, `verify_commissions`,
`update_my_payout`, `request_withdrawal`, `cancel_my_withdrawal`, `decide_withdrawal`, `mark_withdrawal_paid`,
`link_erp_account`, `create_referrer`, `mark_notifications_read`, serta untuk daftar sendiri: `signup_available`, `register_me`,
`update_my_profile`, `set_referrer_active`.
**Baca ringkas:** `calendar(from, to)`, `app_counts()`, `referrer_performance(from, to)`, `ops_performance(from, to, bucket)`,
serta view `participant_overview`, `entry_overview`, `wallets`, `commission_items`.

Angka dashboard harian (PRD bagian 7) per tanggal dari `ref.calendar`:
- Scheduled = tempat di tanggal itu (aktif + selesai)
- Confirmed = available
- Pending = belum dihubungi, dihubungi, atau menunggu jawaban
- Unavailable = tidak bisa atau minta jadwal ulang
- Completed
- Remaining = target − (scheduled − unavailable). Tempat yang unavailable dihitung kosong karena harus diisi orang lain.

Status hari: Planned, Incomplete, Not Planned, Off (target 0).

### Cara memasang

**Status 5 Nov 2026:** ketiga migrasi sudah terpasang, dan `ref` sudah masuk Exposed schemas. Advisor keamanan tidak menemukan apa pun dari schema `ref`. Yang masih harus dilakukan owner di dashboard ada di langkah 3.

1. Jalankan `supabase/migrations/20261104120000_ref_init.sql` di project `vfttmslrjimbndseqqko` (lewat MCP `apply_migration` atau SQL Editor).
   Migrasi ini otomatis menambahkan `ref` ke Exposed schemas.
2. Jalankan juga `supabase/migrations/20261104130000_ref_self_signup.sql`.
3. Supabase → Authentication → Sign In / Providers → Email: **Allow new users to sign up = ON** dan **Confirm email = OFF**.
   Referral lalu daftar sendiri di portal. `supabase/create-referrer.sql` tetap ada untuk admin yang ingin membuatkan akun.
4. Cek Advisors (security + performance) di Supabase.

### Tes

`tests/sql/run.sh` membangun database sementara, menjalankan migrasi, lalu mengikuti satu alur penuh sebagai empat user nyata
(owner, staff, dua referral) dengan RLS aktif: daftar, duplikat, isolasi data, review, target, pindah jadwal, H-1, selesai,
komisi, pencairan, laporan, dan notifikasi. `20_signup.sql` menguji daftar sendiri (username/nomor ganda, login ERP ditolak,
referral baru tidak melihat data siapa pun, referral yang dinonaktifkan kehilangan akses). Jalan di CI (`.github/workflows/ci.yml`) memakai stub kecil skema ERP.
Di lokal, `ERP_DIR=../ERPClaudeKita tests/sql/run.sh` menjalankannya di atas migrasi ERP yang asli.

## 5. Layar

### Referral Portal (repo ini), dibuat sesederhana mungkin dan HP lebih dulu

| Layar | Isi |
|---|---|
| Beranda | Saldo tersedia, peserta dalam proses, jadwal besok (pengingat H-1), notifikasi terbaru |
| Peserta | Daftar peserta milik sendiri dengan badge status dan jadwalnya; tombol "Daftarkan peserta" (form PRD bagian 3, bisa tambah beberapa sekaligus) |
| Detail peserta | Riwayat status, jadwal, alasan bila ditolak; bisa diedit selama masih Submitted |
| Wallet | Total, Pending, Approved, Tersedia, Ditarik; pilih 100rb/200rb/300rb/500rb atau nominal custom; riwayat pencairan dengan bukti bayar |
| Profil | Rekening pencairan, nomor WA |
| Notifikasi | Semua notifikasi, tandai dibaca |

### Layar internal (ERPClaudeKita, menu "Referral")

| Layar | Peran | Isi |
|---|---|---|
| Hari ini | admin, ops | KPI cards (Target, Scheduled, Confirmed, Pending, Unavailable, Completed, Remaining) + progress bar |
| Peserta | admin | Tabel semua peserta. Cari dan filter: referral, WA, email, tanggal masuk, status, jadwal, konfirmasi. Review/approve/reject massal |
| Jadwal | admin | Kalender bulan dengan target vs terisi per hari. Pilih tanggal, ubah target, tambahkan peserta yang siap dijadwalkan, pindahkan, lihat sisa kapasitas |
| Konfirmasi H-1 | admin, ops | Daftar besok. Tombol WhatsApp berisi template pesan, set hasil konfirmasi, catatan, tandai selesai |
| Komisi & Pencairan | admin | Verifikasi komisi pending, proses permintaan pencairan, upload bukti, tandai Paid |
| Laporan | admin | Ranking referral (peserta, selesai, ditolak, konversi, komisi, dibayar) dan performa harian/mingguan/bulanan; ekspor CSV dan Excel |
| Referral | admin | Daftar referral, tambah referral, saldo masing-masing |

UI ERP tetap dua bahasa (ID + 中文) seperti layar lain. Portal dalam Bahasa Indonesia.

### 5b. Tampilan: CodePave

Portal dan layar referral memakai identitas **CodePave** (Brand Guide v1.0, 2 Nov 2026):

| Elemen | Pemakaian di aplikasi |
|---|---|
| Warna | Asphalt `#0B1F24` untuk sidebar, teks, dan header tabel. Cone Orange `#FF5B1F` untuk tombol utama dan angka penting. Signal Mint `#4FE0C0` untuk status berhasil. Lane Teal `#14564F` untuk progress dan header tabel di mode gelap. Concrete `#E8EBE9` untuk latar. Cone Tint `#FFE4D6` untuk kotak catatan |
| Aturan kontras | Teks di atas oranye selalu Asphalt, tidak pernah putih (putih di atas oranye hanya 3,1:1) |
| Huruf | Overpass (400/600/800/900) untuk judul dan isi. Overpass Mono untuk label, eyebrow, angka, dan kode |
| Bentuk | Sudut 4 px, garis putus-putus seperti marka jalan, kartu angka disusun naik-turun seperti pola bata, pola paving pudar di pojok kanan bawah, label section berupa pil Asphalt dengan blok oranye |
| Logo | `codepave` horizontal versi negatif di sidebar Asphalt; blok AI tetap oranye |
| Badge | Selesai/berhasil = mint, perlu cek = cone tint, draf = concrete, ditolak/tidak bisa = merah semantik |

Mode terang dan gelap sama-sama disiapkan. Layar ERP yang sudah ada tidak diubah oleh keputusan ini.

## 6. Fase (sesuai PRD bagian 13)

| Fase | Isi | Status |
|---|---|---|
| 0 | Skema database lengkap untuk semua fase + tes + rencana ini | **Selesai (PR ini)** |
| 0b | Wireframe interaktif portal + layar ERP (`wireframe/index.html`) | **Selesai** |
| 1 | Login portal, daftar peserta, layar Peserta di ERP, review | Berikutnya |
| 2 | Kalender jadwal, target, H-1 + WhatsApp, dashboard harian | |
| 3 | Komisi, wallet, pencairan, bukti bayar | |
| 4 | Laporan, ranking, ekspor CSV/Excel | |

Database sudah mencakup fase 1 sampai 4, jadi fase berikutnya hanya membangun layar tanpa membangun ulang database.

## 7. Pertanyaan terbuka (dengan pilihan default sementara)

| # | Pertanyaan | Default sementara |
|---|---|---|
| Q1 | ~~Tampilan~~ **Diputuskan:** identitas CodePave (Brand Guide v1.0) | Lihat bagian 5b |
| Q2 | Komisi per peserta selesai berapa? Sama untuk semua referral? | Rp 50.000 (`settings.commission_per_completed`), bisa diubah per komisi sebelum diverifikasi |
| Q3 | **Hubungan dengan Rekap.** Rekap ERP sudah memotong "referral Gipong/Zakar" dari bagi hasil harian. Kalau wallet juga membayar mereka, bisa terbayar dua kali. Mana yang jadi sumber pembayaran? | Setelah portal jalan, referral dibayar lewat wallet, dan baris referral di Rekap diisi dari komisi yang di-approve hari itu |
| Q4 | "Completed" artinya apa persisnya? Apakah harus sudah jadi akun di ERP (Akun)? | Ops/admin menandai selesai; link ke akun ERP opsional |
| Q5 | Alamat portal | `referral.tampilresmi.com` (Cloudflare Workers, sama seperti ERP) |
| Q6 | ~~Siapa yang membuat login referral?~~ **Diputuskan:** siapa pun bisa daftar sendiri (username + nomor + password, tanpa verifikasi) | Bagian 2b |
| Q7 | Notifikasi cukup di dalam aplikasi, atau perlu WA/email otomatis? | Di dalam aplikasi dulu (lonceng + badge) |
| Q8 | Tim operasional = user ERP role `staff`? | Ya |

## 8. Catatan keamanan

- Repo ini **public**: kodenya boleh terlihat, tapi jangan pernah commit data peserta, kunci `service_role`, atau `.env`.
- Data di Supabase terenkripsi saat disimpan. Nomor rekening pencairan disimpan biasa di balik RLS (hanya pemiliknya dan admin).
- Backup: paket gratis Supabase tidak punya backup otomatis harian yang bisa di-restore sendiri. Untuk data uang, pertimbangkan
  paket Pro (backup harian) atau ekspor terjadwal.
- **Daftar terbuka.** Karena sign-up dinyalakan untuk seluruh project Supabase, siapa pun bisa membuat login. Login seperti itu
  tidak melihat data ERP apa pun (tidak punya `erp.profiles`, sudah dites) dan hanya melihat data referralnya sendiri. Peserta
  yang didaftarkan tetap harus disetujui admin, dan uang baru bisa dicairkan dari komisi yang sudah diverifikasi.
  Jadi risiko terbesar adalah spam pendaftaran. Kalau itu terjadi, nyalakan CAPTCHA (Cloudflare Turnstile, gratis, biasanya tanpa
  klik) di Authentication → Attack Protection.
- Tanpa email, "lupa password" tidak bisa dilakukan sendiri. Admin mengganti password di Authentication → Users. Nanti ini bisa
  dibuat sebagai tombol di ERP lewat fungsi server.
- Sesi login memakai Supabase Auth (cookie, refresh token). Batas waktu sesi bisa diatur di Authentication → Sessions (paket Pro).

## 9. Keputusan owner (5 Nov 2026)

| Topik | Keputusan |
|---|---|
| Tarik saldo | Setelah mengajukan, referral menekan **Kirim ke WhatsApp admin** (0812-9932-3591) yang berisi jumlah, nomor permintaan, dan norek/VA. Uang ditransfer paling lambat **1x24 jam** (`settings.payout_hours`) |
| Nomor admin | `settings.admin_wa = 6281299323591`. Dipakai untuk lupa password, tanya admin, dan tarik saldo |
| Email peserta | Tetap wajib |
| Ajak teman | Referral bisa mengajak orang lain jadi referral lewat link `referral.tampilresmi.com/daftar?ajak=<username>`. Tercatat di `referrers.invited_by`, pengajak dapat notifikasi. **Belum ada komisi untuk mengajak.** Kalau perlu, tentukan nominalnya |
| Tampilan | Gaya CodePave (wireframe ini) jadi acuan, termasuk untuk layar referral di ERP |
| Admin | Layar admin dan tim ada di repo **ERPClaudeKita** (menu Referral) |
