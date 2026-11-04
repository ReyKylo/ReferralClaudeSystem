# DESIGN.md: CodePave Referral

Ini aturan tampilan dan bahasa untuk portal referral dan layar referral di ERP. Wireframe acuannya `wireframe/index.html`.
Sebuah nilai hanya boleh dipakai kalau ada di sini. Nilai baru harus ditambahkan ke tabel ini beserta alasannya.

## Arah

| | |
|---|---|
| Produk | Portal tempat referral mendaftarkan calon peserta, melihat statusnya, dan menarik komisi; ERP tempat tim menjadwalkan 20 peserta sehari |
| Pemakai utama | Referral awam, memakai HP Android murah, sering sambil chat WhatsApp |
| Karakter | Jelas, sabar, bisa dipercaya, seperti rambu jalan yang terbaca sekali lihat |
| Dunia | Jalan yang sedang diaspal: aspal (warna netral), cone oranye (aksi), marka putus-putus (pemisah), mint (lampu hijau) |
| Momen | Angka saldo, dan "jalan" 4 blok yang menunjukkan tahap peserta |
| Ciri khas | Blok paving. Blok yang sudah selesai berwarna aspal, blok tahap sekarang oranye (blok AI di logo), dan blok yang belum dilalui kosong |

Yang sengaja **tidak** diambil dari Brand Guide, karena itu gaya dokumen dan bukan gaya aplikasi untuk orang awam:
label huruf besar berjarak (eyebrow), huruf ExtraBold/Black di judul, kartu angka naik-turun, dan kotak catatan bergaris kiri.

## Token

### Jarak
`4 · 8 · 12 · 16 · 20 · 24 · 32 · 48` (`--s1`…`--s8`). Isi dalam satu kelompok lebih rapat daripada jarak antarbagian.
Sudut: 4 px untuk kontrol dan kartu (Brand Guide), 2 px untuk elemen di dalamnya (badge, blok paving, tooltip).

### Huruf
Overpass dipilih karena turunan huruf rambu jalan, terbaca cepat dari jauh. Overpass Mono hanya untuk kode (nomor permintaan, referensi transfer).

| Peran | Ukuran / tebal |
|---|---|
| Angka utama (saldo, KPI) | 32 / 700, angka tabular |
| Judul layar | 20 / 600 |
| Isi, input, tombol | 16 / 400, tombol 600 |
| Keterangan, tabel ERP | 14 / 400 |
| Label tab bawah, kalender | 12 / 600 |

Tidak ada huruf kapital semua, dan tidak ada huruf di bawah 12 px. Input selalu 16 px supaya HP tidak zoom.

### Warna (terang / gelap)

| Token | Terang | Gelap | Pakai untuk |
|---|---|---|---|
| Kanvas | `#EFF1F0` | `#0B1F24` | Latar halaman |
| Permukaan | `#FFFFFF` | `#112B31` | Kartu, input, tab bawah |
| Teks 1 / 2 / 3 | `#0B1F24` / `#46575B` / `#5C6B6E` | `#FFFFFF` / `#B9CACA` / `#9AAFAF` | Isi / keterangan / ikon redup |
| Aksen | `#FF5B1F`, teks di atasnya `#0B1F24` | sama | Hanya tombol utama dan blok tahap sekarang |
| Tautan | `#B8400E` | `#FF8A57` | Tautan teks |
| Berhasil | `#D5F5EC` / `#14564F` | mint 14% / `#4FE0C0` | Diterima, selesai, sudah ditransfer |
| Perlu cek | `#FFE4D6` / `#A3360A` | oranye 16% / `#FFA27A` | Sedang dicek, menunggu |
| Gagal | `#FBE4E1` / `#A3201A` | merah 15% / `#FF9A92` | Ditolak, tidak bisa |
| Netral | `#E3E7E5` / `#3D4B4F` | putih 8% / `#C8D5D5` | Dikirim, dibatalkan |

Status selalu berupa **kata + warna**, tidak pernah warna saja. Teks di atas oranye selalu Asphalt.

### Bahan
Semua permukaan padat dan tanpa efek blur. Kartu hanya dipakai untuk benda yang berdiri sendiri. Garis pemisah putus-putus 1 px seperti marka jalan.

### Detail
- **Ikon:** Lucide (sama dengan ERP), 20 px (tab bawah 24 px), garis 2. Setiap ikon selalu didampingi teks.
- **Tombol utama:** satu per layar.

  | Layar | Tombol utama |
  |---|---|
  | Beranda | Daftarkan peserta |
  | Peserta | Daftarkan peserta |
  | Form | Kirim pendaftaran |
  | Saldo | Tarik Rp… |
  | Daftar / Masuk | Daftar dan masuk / Masuk |
- **Sentuhan:** semua tombol minimal 48 px tinggi di HP (44 px untuk tombol kecil), dan baris daftar minimal 64 px.
- **Navigasi HP:** tab bawah 4 menu berlabel (Beranda, Peserta, Saldo, Notifikasi). Penanda menu yang aktif adalah blok oranye kecil di atas ikon.

## Bahasa

Satu kata untuk satu hal, di semua layar dan notifikasi:

| Pakai | Jangan pakai |
|---|---|
| Tarik saldo | Pencairan, withdrawal, wallet |
| Saldo bisa ditarik | Available balance, saldo tersedia |
| Komisi sedang dicek tim | Pending commission |
| Diterima / Ditolak | Approved / Rejected |
| Sudah ditransfer | Paid |
| Dijadwalkan Kamis, 5 Nov jam 10.00 | Scheduled, 2026-11-05 10:00 |

Aturan lainnya:
- Uang ditulis `Rp50.000`, jam ditulis `10.00`, dan tanggal ditulis `Kamis, 5 Nov`.
- Pesan salah menyebut apa yang salah dan cara membetulkannya. Pesan itu tampil di bawah kolomnya, lalu kursor pindah ke kolom pertama yang salah.
- Kata di tombol sama dengan kata di pesan sesudahnya. Contoh: tombol "Kirim pendaftaran" diikuti pesan "Pendaftaran … terkirim".
- Tidak memakai sapaan, tanda seru, atau kata promosi.

## Perilaku

| Situasi | Perilaku |
|---|---|
| Aksi rutin admin/ops (setujui, catat konfirmasi, jadwalkan, target) | Langsung dijalankan, lalu muncul toast dengan tombol **Urungkan** selama 6 detik |
| Tarik saldo (uang) | Pilih nominal, lalu konfirmasi di halaman yang menyebut jumlah dan rekening. Setelah itu muncul bukti dengan nomor `TS-0004`, dan permintaan masih bisa **dibatalkan** selama admin belum memproses |
| Tandai sudah ditransfer (admin) | Wajib mengisi nomor referensi transfer atau mengunggah bukti |
| Kirim pendaftaran | Layar "terkirim" menampilkan tahap peserta dan dua langkah berikutnya |
| Ditolak | Alasan ditampilkan, plus tombol **Perbaiki** yang membuka form berisi data lama |

## Keadaan yang wajib ada di aplikasi asli

| Keadaan | Perilaku |
|---|---|
| Kosong | Kalimat yang menjelaskan apa yang akan muncul dan cara memulainya. Ini sudah ada di wireframe |
| Memuat | Kerangka abu-abu muncul setelah 400 ms dan tampil minimal 500 ms supaya tidak berkedip. Belum ada di wireframe |
| Gagal memuat / offline | "Tidak tersambung. Periksa internet Anda, lalu coba lagi." dengan tombol Coba lagi. Isi form yang sedang diketik tetap tersimpan. Belum ada di wireframe |
| Nonaktif | Referral yang dinonaktifkan melihat "Akun Anda sedang dinonaktifkan. Hubungi admin." dengan tombol chat admin. Belum ada di wireframe |
| Nama panjang | Teks turun ke baris baru, tidak dipotong |

## Hasil audit (deslop, auditor independen)

| | Sebelum | Iterasi 1 | Iterasi 2 | Akhir |
|---|---|---|---|---|
| Scanner | 53 | 100 | 100 | 100 |
| Slop Score (auditor) | – | 66,5 | 91 | **96** |
| Usability (Nielsen) | – | 27/40 | 29/40 | **30/40** |
| P0 / P1 | – | 0 / 4 | 1 / 0 | **0 / 0** |
| Gate | – | Gagal | Gagal | **Lulus** |

Usability lulus tanpa sisa ruang. Yang paling murah untuk menaikkannya adalah perkiraan kapan uang tarik saldo masuk.
Angka itu menunggu keputusan owner, dan tidak boleh dikarang.

Sisa catatan kecil (P3):
- Lebar inline satu-satu (170/192/240 px).
- Huruf mono di baris keterangan ERP.
- Kotak legenda mint di atas putih.
- Kotak-kotak di halaman Saldo masih bertumpuk.
- 7 kartu KPI di "Hari ini". Ini memang diminta PRD.
- Baris H-1 yang padat.

Pelajaran: scanner memberi 100, tapi auditor menemukan 4 masalah alur dan 1 crash saat runtime. Setiap perbaikan alur
harus diuji dengan menjalankan alurnya, misalnya kirim ulang setelah "Perbaiki", tidak cukup dengan scan.
