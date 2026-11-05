import { expect, test, type Page } from '@playwright/test';

const MOCK = 'http://127.0.0.1:54322';

test.beforeEach(async ({ request }) => { await request.get(`${MOCK}/__reseed`); await request.get(`${MOCK}/__setting?key=confirm_deadline&value=23:59`); });

async function login(page: Page, id = 'gipong', pw = 'rahasia123') {
  await page.goto('/masuk/');
  await page.getByRole('button', { name: 'Masuk', exact: true }).first().click();
  await page.getByLabel('Nama pengguna atau nomor WhatsApp').fill(id);
  await page.getByLabel('Password', { exact: true }).fill(pw);
  await page.locator('form').getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beranda' })).toBeVisible();
}

test('signed-out visitors land on the sign-in page', async ({ page }) => {
  await page.goto('/saldo/');
  await expect(page).toHaveURL(/\/masuk\//);
  await expect(page.getByRole('button', { name: 'Daftar dan masuk' })).toBeVisible();
});

test('sign up with username, number and password through an invite link, then register a participant', async ({ page }) => {
  await page.goto('/masuk/?ajak=gipong');
  await expect(page.getByText('Anda diajak oleh')).toBeVisible();
  await page.getByLabel('Nama pengguna (username)').fill('Budi Baru');
  await expect(page.getByText('Tanpa spasi. Coba:')).toBeVisible();
  await page.getByLabel('Nama pengguna (username)').fill('budi.baru');
  await expect(page.getByText('Bisa dipakai.')).toBeVisible();
  await page.getByLabel('Nomor WhatsApp').fill('0812-1111-1111');
  await page.getByLabel('Password', { exact: true }).fill('rahasia1');
  await page.getByRole('button', { name: 'Daftar dan masuk' }).click();
  await expect(page.getByText(/sudah dipakai/)).toBeVisible();
  await page.getByLabel('Nomor WhatsApp').fill('0812-5555-0101');
  await page.getByRole('button', { name: 'Daftar dan masuk' }).click();
  await expect(page.getByRole('heading', { name: 'Beranda' })).toBeVisible();
  await expect(page.getByLabel('Link ajak Anda')).toHaveValue('https://referral.tampilresmi.com/masuk/?ajak=budi.baru');

  await page.getByRole('link', { name: 'Daftarkan nomor' }).first().click();
  await page.getByRole('button', { name: 'Kirim pendaftaran' }).click();
  await expect(page.getByText('Isi nama pemilik nomor.')).toBeVisible();
  await expect(page.getByText('Isi password akun, minimal 6 karakter.')).toBeVisible();
  await page.getByLabel('Nama pemilik nomor').fill('Rudi Hartono');
  await page.getByLabel('Nomor WhatsApp').fill('0857-1234-5678');
  await page.getByLabel('Email', { exact: true }).fill('rudi.hartono@gmail.com');
  await page.getByLabel('Password akun').fill('rahasia-rudi');
  await page.getByRole('button', { name: 'Sen', exact: true }).click();
  await page.getByRole('button', { name: 'Rab', exact: true }).click();
  await page.getByRole('button', { name: /Siang/ }).click();
  await page.getByText('Pemilik nomor sudah setuju datanya didaftarkan dan dijadwalkan lewat saya.').click();
  await page.getByRole('button', { name: 'Kirim pendaftaran' }).click();
  await expect(page.getByRole('heading', { name: 'Nomor Rudi Hartono terkirim' })).toBeVisible();
  await page.getByRole('link', { name: 'Lihat semua nomor' }).click();
  await page.getByRole('link', { name: /Rudi Hartono/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Sen, Rab');
  await expect(page.getByRole('dialog')).toContainText('Tersimpan');
  await expect(page.getByRole('dialog')).not.toContainText('rahasia-rudi');
});

test('sign in with the WhatsApp number; wrong password gets one plain message', async ({ page }) => {
  await page.goto('/masuk/');
  await page.getByRole('button', { name: 'Masuk', exact: true }).first().click();
  await page.getByLabel('Nama pengguna atau nomor WhatsApp').fill('0812 1111 1111');
  await page.getByLabel('Password', { exact: true }).fill('salah');
  await page.locator('form').getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Username/nomor atau password salah' })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('rahasia123');
  await page.locator('form').getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Beranda' })).toBeVisible();
});

test('fix a rejected participant: the old inactive number is refused, a new one goes through', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Perbaiki' }).click();
  await expect(page.getByLabel('Nama pemilik nomor')).toHaveValue('Hendra Nugroho');
  await expect(page.getByLabel('Password akun')).toHaveValue('');          // the password is asked again
  await page.getByText('Pemilik nomor sudah setuju datanya didaftarkan dan dijadwalkan lewat saya.').click();
  await page.getByRole('button', { name: 'Kirim pendaftaran' }).click();
  await expect(page.getByText(/Nomor ini yang tadi ditolak/)).toBeVisible();
  await page.getByLabel('Nomor WhatsApp').fill('0813-7777-1212');
  await page.getByLabel('Password akun').fill('password-baru');
  await page.getByRole('button', { name: 'Kirim pendaftaran' }).click();
  await expect(page.getByRole('heading', { name: 'Nomor Hendra Nugroho terkirim' })).toBeVisible();
  await page.getByRole('link', { name: 'Lihat semua nomor' }).click();
  // the rejected row is replaced by the new submission
  await expect(page.getByRole('link', { name: /Hendra Nugroho/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Ditolak/ })).toContainText('0');
});

test('withdraw: confirm, receipt with request number and WhatsApp message to the admin, then cancel', async ({ page }) => {
  await login(page);
  await page.goto('/saldo/');
  // 3 approved commissions (150.000) minus 50.000 already paid
  await expect(page.locator('.money .big')).toHaveText('Rp100.000');
  await page.getByRole('button', { name: /Semua/ }).click();
  await page.getByRole('button', { name: 'Tarik Rp100.000' }).click();
  await expect(page.getByText('Tarik Rp100.000 ke BCA 1234567890 a.n. Gipong Saputra?')).toBeVisible();
  await page.getByRole('button', { name: 'Ya, tarik saldo' }).click();
  await expect(page.getByRole('heading', { name: 'Permintaan tarik saldo terkirim' })).toBeVisible();
  await expect(page.locator('.receipt')).toContainText('TS-0002');
  const href = await page.getByRole('link', { name: 'Kirim ke WhatsApp admin' }).getAttribute('href');
  expect(href).toContain('wa.me/6281299323591');
  const text = decodeURIComponent(new URL(href!).searchParams.get('text')!);
  expect(text).toContain('Nomor permintaan: TS-0002');
  expect(text).toContain('Kirim ke: BCA 1234567890 a.n. Gipong Saputra');
  await expect(page.locator('.money .big')).toHaveText('Rp0');
  await page.getByRole('button', { name: 'Batalkan permintaan ini' }).click();
  await expect(page.getByText('Dibatalkan. Rp100.000 kembali ke saldo.')).toBeVisible();
  await expect(page.locator('.money .big')).toHaveText('Rp100.000');
});

test('a new referral with no balance is told when withdrawing becomes possible', async ({ page }) => {
  await page.goto('/masuk/');
  await page.getByLabel('Nama pengguna (username)').fill('sari');
  await page.getByLabel('Nomor WhatsApp').fill('0812-6666-0101');
  await page.getByLabel('Password', { exact: true }).fill('rahasia1');
  await page.getByRole('button', { name: 'Daftar dan masuk' }).click();
  await expect(page.getByRole('heading', { name: 'Beranda' })).toBeVisible();
  await page.goto('/saldo/');
  await expect(page.locator('.note').getByText('Saldo bisa ditarik mulai Rp50.000')).toBeVisible();
});

test('notifications: open one marks it read and goes to its screen', async ({ page }) => {
  await login(page);
  await page.goto('/notifikasi/');
  await expect(page.getByText('2 belum dibaca.')).toBeVisible();
  await page.getByRole('button', { name: /Hendra Nugroho ditolak/ }).click();
  await expect(page).toHaveURL(/\/peserta\/\?id=/);
  await expect(page.getByRole('dialog')).toContainText('Nomor WhatsApp tidak aktif');
  await page.goto('/notifikasi/');
  await expect(page.getByText('1 belum dibaca.')).toBeVisible();
  await page.getByRole('button', { name: 'Tandai semua dibaca' }).click();
  await expect(page.getByText('Semua sudah dibaca.')).toBeVisible();
});

test('unknown address shows the 404 page', async ({ page }) => {
  const r = await page.goto('/tidak-ada/');
  expect(r?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Halaman tidak ditemukan' })).toBeVisible();
});

test('a sign-up that stopped halfway is finished by signing up again with the same password', async ({ page, request }) => {
  // the login exists but the referral row was never made (page closed between the two steps)
  await request.post(`${MOCK}/auth/v1/signup`, { data: { email: 'tono@referral.tampilresmi.com', password: 'rahasia1' } });
  await page.goto('/masuk/');
  await page.getByLabel('Nama pengguna (username)').fill('tono');
  await page.getByLabel('Nomor WhatsApp').fill('0812-7777-0101');
  await page.getByLabel('Password', { exact: true }).fill('rahasia1');
  await page.getByRole('button', { name: 'Daftar dan masuk' }).click();
  await expect(page.getByRole('heading', { name: 'Beranda' })).toBeVisible();
});

test('Besok: the team already chatted the referral, who marks each number ready or not and sends one answer', async ({ page }) => {
  await login(page);
  await expect(page.getByText('Besok: 3 nomor')).toBeVisible();
  await expect(page.getByText(/3 belum dikonfirmasi/)).toBeVisible();
  await page.getByRole('link', { name: /Besok 3 nomor/ }).click();
  await expect(page.getByRole('heading', { name: 'Besok: 3 nomor' })).toBeVisible();
  await expect(page.getByText(/Konfirmasi paling lambat/)).toContainText('jam 23.59');   // the deadline comes from the settings (23:59 in these tests)
  await expect(page.getByRole('button', { name: 'Pilih jawaban dulu' })).toBeDisabled();
  // every number has a chat link to its owner
  const chat = await page.locator('[data-entry]').first().getByRole('link', { name: 'Chat pemilik' }).getAttribute('href');
  expect(chat).toContain('wa.me/62813');
  expect(decodeURIComponent(chat!)).toContain('nomor kamu dipakai');
  const eka = page.locator('[data-entry]').filter({ hasText: 'Eka Kusuma' });
  const indah = page.locator('[data-entry]').filter({ hasText: 'Indah Permata' });
  const joko = page.locator('[data-entry]').filter({ hasText: 'Joko Hakim' });
  await eka.getByRole('button', { name: 'Siap', exact: true }).click();
  await indah.getByRole('button', { name: 'Siap', exact: true }).click();
  await joko.getByRole('button', { name: 'Tidak bisa' }).click();
  await page.getByLabel('Catatan untuk tim').fill('Joko baru bisa lusa');
  await page.getByRole('button', { name: 'Kirim konfirmasi (3)' }).click();
  await expect(page.getByText('Konfirmasi terkirim. Terima kasih!')).toBeVisible();
  await expect(page.getByText('Semua sudah dijawab')).toBeVisible();
  await expect(eka.getByText('Siap', { exact: true }).first()).toBeVisible();
  await expect(joko.getByText('Tidak bisa').first()).toBeVisible();
  // changing one answer is allowed before the deadline
  await joko.getByRole('button', { name: 'Siap', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Kirim konfirmasi (1)' })).toBeVisible();
  // the next day is a tab; its number is already ready
  await page.getByRole('button', { name: /Jumat|Sabtu|Minggu|Senin|Selasa|Rabu|Kamis/ }).first().click();
  await expect(page.getByText('Kartika Utami')).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Semua sudah dikonfirmasi. Terima kasih!')).toBeVisible();
});

test('Besok: after the deadline the answers are locked and the referral is sent to the admin', async ({ page, request }) => {
  await request.get(`${MOCK}/__setting?key=confirm_deadline&value=00:00`);
  await login(page);
  await page.goto('/besok/');
  await expect(page.getByText(/Batas konfirmasi jam 00.00 sudah lewat/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Siap', exact: true }).first()).toBeDisabled();
  await expect(page.getByRole('button', { name: /Kirim konfirmasi|Pilih jawaban dulu/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Chat admin' })).toHaveAttribute('href', /wa\.me\/6281299323591/);
});

test('a link from WhatsApp to /besok/ survives the sign-in page', async ({ page }) => {
  await page.goto('/besok/');
  await expect(page).toHaveURL(/\/masuk\/\?next=%2Fbesok%2F/);
  await page.getByRole('button', { name: 'Masuk', exact: true }).first().click();
  await page.getByLabel('Nama pengguna atau nomor WhatsApp').fill('gipong');
  await page.getByLabel('Password', { exact: true }).fill('rahasia123');
  await page.locator('form').getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Besok: 3 nomor' })).toBeVisible();
  // only paths inside the site are followed
  await page.evaluate(() => localStorage.clear());
});

test('the password is never kept in the draft on the phone', async ({ page }) => {
  await login(page);
  await page.goto('/daftar/');
  await page.getByLabel('Nama pemilik nomor').fill('Sari Dewi');
  await page.getByLabel('Password akun').fill('jangan-disimpan');
  await page.getByRole('button', { name: 'Selasa'.slice(0, 3), exact: true }).click();
  const draft = await page.evaluate(() => localStorage.getItem('cp-ref-draft'));
  expect(draft).toContain('Sari Dewi');
  expect(draft).not.toContain('jangan-disimpan');
  await page.reload();
  await expect(page.getByLabel('Nama pemilik nomor')).toHaveValue('Sari Dewi');
  await expect(page.getByLabel('Password akun')).toHaveValue('');
});

test('commission shown follows the rate the admin set for this referral', async ({ page, request }) => {
  await login(page);
  await page.goto('/saldo/');
  await page.getByText('Cara kerja komisi').click();
  await expect(page.getByText(/memberi komisi Rp75\.000/)).toBeVisible();
  await request.get(`${MOCK}/__rate?referrer=r-gipong&value=100000`);
  await page.reload();
  await page.getByText('Cara kerja komisi').click();
  await expect(page.getByText(/memberi komisi Rp100\.000/)).toBeVisible();
});

test('Cara mulai opens without an account and quotes the live numbers', async ({ page }) => {
  await page.goto('/masuk/');
  await page.getByRole('link', { name: 'Lihat cara mulai' }).click();
  await expect(page).toHaveURL(/\/mulai\//);
  await expect(page.getByRole('heading', { name: 'Cara mulai jadi referral' })).toBeVisible();
  await expect(page.getByText(/komisi Rp75\.000/)).toBeVisible();
  await expect(page.getByText(/paling lambat jam 23\.59/).first()).toBeVisible();   // quoted from the settings, not hard-coded
  await expect(page.getByText(/kode OTP/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Buat akun' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Chat admin' })).toHaveAttribute('href', /wa\.me\/6281299323591/);
});
