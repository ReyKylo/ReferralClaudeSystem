import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Shell';

export const metadata: Metadata = {
  title: 'CodePave Referral',
  description: 'Daftarkan nomor, lihat jadwal dan statusnya, dan tarik komisi Anda.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0B1F24' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Overpass:wght@400;600;700&family=Overpass+Mono:wght@400;600&display=swap" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
