import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import PwaRegistrar from '@/components/PwaRegistrar';
import SystemConfigBanner from '@/components/SystemConfigBanner';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'PulseGuard AI · Real-Time Edge Sentinel & Emergency Mesh',
  description:
    'Zero-cloud Edge AI audio/biometric emergency sentinel, Web Crypto E2EE 52-byte binary SMS failover, and live NMC/ABDM responder dispatch mesh.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'PulseGuard AI',
  },
};

export const viewport: Viewport = {
  themeColor: '#05080F',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="min-h-screen bg-[#05080F] font-sans text-slate-100 antialiased selection:bg-cyan-500/30 selection:text-cyan-100">
        <PwaRegistrar />
        <SystemConfigBanner />
        {children}
      </body>
    </html>
  );
}
