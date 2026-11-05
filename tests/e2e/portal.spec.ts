import { expect, test, type Page } from '@playwright/test';

const MOCK = 'http://127.0.0.1:54322';

test.beforeEach(async ({ request }) => { await request.get(`${MOCK}/__reseed`); });

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

  await page.getByRole('link', { name: 'Daftarkan peserta' }).first().click();
  await page.getByRole('button', { name: 'Kirim pendaftaran' }).click();
  await expect(page.getByText('Isi nama peserta.')).toBeVisible();
  await page.getByLabel('Nama peserta').fill('Rudi Hartono');
  await page.getByLabel('Nomor WhatsApp peserta').fill('0857-1234-5678');
  await page.getByLabel('Email peserta').fill('rudi.hartono@gmail.com');
  await page.getByRole('button', { name: /Siang/ }).click();
  await page.getByText('Peserta sudah setuju dihubungi tim lewat WhatsApp.').click();
  await page.getByRole('button', { name: 'Kirim pendaftaran' }).click();
  await expect(page.getByRole('heading', { name: 'Pendaftaran Rudi Hartono terkirim' })).toBeVisible();
  await page.getByRole('link', { name: 'Lihat semua peserta' }).click();
  await expect(page.getByRole('link', { name: /Rudi Hartono/ })).toBeVisible();
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
  await expect(page.getByLabel('Nama peserta')).toHaveValue('Hendra Nugroho');
  await page.getByText('Peserta sudah setuju dihubungi tim lewat WhatsApp.').click();
  await page.getByRole('button', { name: 'Kirim pendaftaran' }).click();
  await expect(page.getByText(/Nomor ini yang tadi ditolak/)).toBeVisible();
  await page.getByLabel('Nomor WhatsApp peserta').fill('0813-7777-1212');
  await page.getByRole('button', { name: 'Kirim pendaftaran' }).click();
  await expect(page.getByRole('heading', { name: 'Pendaftaran Hendra Nugroho terkirim' })).toBeVisible();
  await page.getByRole('link', { name: 'Lihat semua peserta' }).click();
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
