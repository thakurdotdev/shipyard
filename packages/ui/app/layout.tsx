import { AuthGuard } from '@/components/auth-guard';
import { MobileTabBar, Navbar } from '@/components/navbar';
import { PwaProvider } from '@/components/pwa/pwa-provider';
import { ThemeProvider } from '@/components/theme-provider';
import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Shipyard',
  description: 'Manage application builds, deployments, and runtime services.',
  applicationName: 'ShipYard',
  manifest: '/manifest.json',
  // iOS before 17 only opens full-screen from the Home Screen with this tag.
  other: { 'apple-mobile-web-app-capable': 'yes' },
  appleWebApp: { capable: true, title: 'ShipYard', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the app draw under the notch; the bars pad themselves with the safe areas.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0b' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-background font-sans flex flex-col`}
      >
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <Toaster
            richColors
            position="bottom-right"
            mobileOffset={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}
          />
          <PwaProvider />
          <AuthGuard>
            <Navbar />
            <main className="flex-1">{children}</main>
            <MobileTabBar />
          </AuthGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}
