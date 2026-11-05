# Memasang portal referral di referral.tampilresmi.com

Portal ini halaman statis (Next.js export) yang disajikan Cloudflare Workers. Datanya langsung dari Supabase (schema `ref`),
dan yang boleh dibaca atau diubah ditentukan RLS dan fungsi SQL. Server sendiri tidak ada.

Ada 3 hal yang dikerjakan sekali saja oleh owner: setting Supabase Auth, secret Cloudflare di GitHub, dan branch utama.

## 1. Supabase: daftar tanpa verifikasi email

Referral daftar dengan username, nomor WhatsApp, dan password. Di belakang layar portal membuat login
`<username>@referral.tampilresmi.com`, alamat yang tidak pernah menerima email. Karena itu verifikasi email harus mati.

1. Buka https://supabase.com/dashboard/project/vfttmslrjimbndseqqko/auth/providers
   (menu kiri **Authentication**, lalu **Sign In / Providers**).
2. Di bagian **User Signups**, nyalakan **Allow new users to sign up**.
3. Di bagian yang sama, matikan **Confirm email**.
   - Kalau tidak ada di situ, klik provider **Email** di daftar provider. **Confirm email** ada di panel yang terbuka.
     Pastikan **Enable Email provider** tetap menyala.
4. Klik **Save changes**.

Cara mengecek: buka portal, pilih **Daftar baru**, isi username, nomor, dan password. Kalau langsung masuk ke Beranda,
setting sudah benar. Kalau muncul pesan *"Admin perlu mematikan Confirm email"*, langkah 3 belum tersimpan.

Yang tidak berubah dengan setting ini:
- Login tim ERP tetap dibuat owner. Akun yang daftar sendiri hanya bisa menjadi referral; fungsi SQL menolak menjadikannya
  admin atau staff.
- Referral hanya melihat peserta, saldo, dan notifikasinya sendiri (RLS).

### Lupa password

Referral menekan **Lupa password?** lalu chat admin di WhatsApp. Email reset tidak bisa dipakai karena alamat loginnya tidak
menerima email. Owner mengganti password lewat **SQL Editor** di Supabase:

```sql
-- ganti budi.santoso dan PasswordBaru123 dulu
update auth.users
   set encrypted_password = extensions.crypt('PasswordBaru123', extensions.gen_salt('bf'))
 where email = 'budi.santoso@referral.tampilresmi.com';
```

Hasilnya harus `1 row`. Kirim password baru ke nomor WhatsApp yang terdaftar di akun itu (cek dulu di ERP → Referral), dan
minta referral menggantinya sendiri nanti.

## 2. Cloudflare: secret untuk deploy otomatis

Setiap push ke `main` menjalankan `.github/workflows/deploy.yml`: build, lalu `wrangler deploy` ke Worker
`referral-portal` dengan domain `referral.tampilresmi.com`. Workflow butuh dua secret.

### CLOUDFLARE_ACCOUNT_ID

1. Buka https://dash.cloudflare.com dan pilih akun yang memegang `tampilresmi.com`.
2. Di menu kiri pilih **Workers & Pages**. **Account ID** ada di panel kanan. Klik untuk menyalin.

### CLOUDFLARE_API_TOKEN

1. Buka https://dash.cloudflare.com/profile/api-tokens lalu **Create Token**.
2. Pilih template **Edit Cloudflare Workers** → **Use template**.
3. **Account Resources**: Include, akun Anda. **Zone Resources**: Include, Specific zone, `tampilresmi.com`.
4. Tambah satu baris di **Permissions**: Zone → **DNS** → **Edit** (dipakai untuk membuat domain
   `referral.tampilresmi.com`).
5. **Continue to summary** → **Create Token**, lalu salin token-nya. Token hanya tampil sekali.

Kalau token yang sama sudah dipakai untuk ERP dan punya izin di atas, boleh dipakai lagi.

### Memasukkan ke GitHub

1. Buka https://github.com/ReyKylo/ReferralClaudeSystem/settings/secrets/actions
2. **New repository secret**: nama `CLOUDFLARE_API_TOKEN`, isi token tadi. Simpan.
3. **New repository secret**: nama `CLOUDFLARE_ACCOUNT_ID`, isi Account ID. Simpan.

Jangan menaruh token ini di file mana pun di repo. Repo ini publik.

## 3. GitHub: jadikan `main` branch utama

1. Buka https://github.com/ReyKylo/ReferralClaudeSystem/settings
2. Di **Default branch**, klik ikon panah, pilih `main`, lalu **Update**.

## 4. Deploy pertama

Setelah PR portal di-merge ke `main`, workflow **Deploy portal** jalan sendiri. Bisa juga dijalankan manual:
**Actions → Deploy portal → Run workflow**.

Kalau berhasil, https://referral.tampilresmi.com terbuka dalam 1–2 menit (sertifikat HTTPS kadang butuh sampai 15 menit di
pemasangan pertama).

Kalau langkah **Deploy to Cloudflare** gagal karena domain, pasang domain lewat dashboard:
**Workers & Pages → referral-portal → Settings → Domains & Routes → Add → Custom domain** →
`referral.tampilresmi.com`. Deploy berikutnya tidak perlu langkah ini lagi.

## Menjalankan di komputer sendiri

```bash
npm install
npm run dev:mock                      # Supabase tiruan di port 54322, login: gipong / rahasia123
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54322 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=mock npm run dev
npm run test:e2e                      # build + tes klik di layar HP dan desktop
```

Tanpa variabel `NEXT_PUBLIC_*`, `npm run dev` memakai Supabase asli.
