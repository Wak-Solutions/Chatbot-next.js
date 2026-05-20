import type { Metadata, Viewport } from 'next';
import { Inter, Cairo } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-inter',
  display: 'swap',
});

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-cairo-google',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://wak-solutions.com'),
  title: {
    default: 'WAK Solutions — Intelligent Automation & Robotics',
    template: '%s · WAK Solutions',
  },
  description:
    'Intelligent automation and robotics for a smarter, more efficient, and sustainable future.',
  applicationName: 'WAK Solutions',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '32x32' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'WAK Solutions',
    title: 'WAK Solutions — Intelligent Automation & Robotics',
    description:
      'Intelligent automation and robotics for a smarter, more efficient, and sustainable future.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'WAK Solutions' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WAK Solutions — Intelligent Automation & Robotics',
    description:
      'Intelligent automation and robotics for a smarter, more efficient, and sustainable future.',
    images: ['/og-image.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#0066FF',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${cairo.variable} dark`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
