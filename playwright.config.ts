import { defineConfig, devices } from '@playwright/test';

const PORT = 3201;
const MOCK = 54322;
// In sandboxes with a preinstalled browser, point PW_CHROMIUM at it. Elsewhere `npx playwright install chromium` is enough.
const executablePath = process.env.PW_CHROMIUM || undefined;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], launchOptions: { executablePath } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions: { executablePath } } },
  ],
  webServer: [
    { command: 'node tests/e2e/mock-supabase.mjs', port: MOCK, env: { MOCK_PORT: String(MOCK) }, reuseExistingServer: true },
    {
      // The static export with the mock baked in, served like Cloudflare serves it. `npm run deploy` rebuilds before deploying.
      command: 'npx next build && node tests/e2e/serve-out.mjs',
      port: PORT, timeout: 300_000, reuseExistingServer: true,
      env: { PORT: String(PORT), NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'mock' },
    },
  ],
});
