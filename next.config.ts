import type { NextConfig } from 'next';

// A fully static site: every page reads Supabase from the browser, and RLS decides what each referral may see.
// `next build` writes it to out/, which Cloudflare serves as static assets (wrangler.jsonc).
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};
export default config;
