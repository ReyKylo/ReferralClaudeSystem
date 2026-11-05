# Memasang portal referral di referral.tampilresmi.com

Portal ini halaman statis (Next.js export) yang disajikan Cloudflare Workers. Datanya langsung dari Supabase (schema `ref`),
dan yang boleh dibaca atau diubah ditentukan RLS dan fungsi SQL. Server sendiri tidak ada.

Ada 3 hal yang dikerjakan sekali saja oleh owner: setting Supabase Auth, domain di Cloudflare, dan branch utama.

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

## 2. Cloudflare: deploy dan domain

Repo ini sudah tersambung ke Cloudflare Workers Builds (Worker `referralclaudesystem`), sama seperti ERP. Setiap push ke
`main` di-build dan di-deploy otomatis oleh Cloudflare. Tidak perlu token atau secret di GitHub. `wrangler.jsonc` menjalankan
`npm run build` sendiri sebelum deploy, jadi kolom build command di dashboard boleh kosong.

Cek setting build sekali:

1. Buka https://dash.cloudflare.com → **Workers & Pages** → **referralclaudesystem** → **Settings** → **Build**.
2. **Production branch**: `main`. **Deploy command**: `npx wrangler deploy`. **Build command**: kosong (atau `npm run build`).
3. Simpan kalau ada yang diubah.

Pasang domain sekali (setelah deploy pertama berhasil):

1. Di Worker yang sama: **Settings** → **Domains & Routes** → **Add** → **Custom domain**.
2. Isi `referral.tampilresmi.com` → **Add domain**. Cloudflare membuat DNS dan sertifikat HTTPS-nya sendiri
   (biasanya 1–2 menit, paling lama sekitar 15 menit).

## 3. GitHub: jadikan `main` branch utama

1. Buka https://github.com/ReyKylo/ReferralClaudeSystem/settings
2. Di **Default branch**, klik ikon panah, pilih `main`, lalu **Update**.

## 4. Deploy pertama

Merge PR portal ke `main`. Cloudflare membangun dan men-deploy dalam beberapa menit; statusnya ada di
**Workers & Pages → referralclaudesystem → Deployments**. Setelah domain dipasang, buka https://referral.tampilresmi.com.

## Menjalankan di komputer sendiri

```bash
npm install
npm run dev:mock                      # Supabase tiruan di port 54322, login: gipong / rahasia123
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54322 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=mock npm run dev
npm run test:e2e                      # build + tes klik di layar HP dan desktop
```

Tanpa variabel `NEXT_PUBLIC_*`, `npm run dev` memakai Supabase asli.
