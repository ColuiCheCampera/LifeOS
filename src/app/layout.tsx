import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';
import './globals.css';
import { PwaControls } from '@/features/pwa/ui';
export const metadata: Metadata = {
  title: { default: 'LifeOS — Il tuo spazio personale', template: '%s · LifeOS' },
  description: 'Uno spazio personale per ciò che conta.',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'LifeOS' },
  icons: { apple: '/pwa/apple-touch-icon.png', icon: '/pwa/icon-192.png' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8f4' },
    { media: '(prefers-color-scheme: dark)', color: '#141c18' },
  ],
};
export const dynamic = 'force-dynamic';
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  await headers();
  return (
    <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning>
      <body>
        <NextIntlClientProvider>
          {children}
          <PwaControls />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
