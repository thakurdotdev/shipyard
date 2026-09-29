import { AuthGuard } from '@/components/auth-guard';
import { Footer } from '@/components/footer';
import { Grain } from '@/components/grain';
import { Navbar } from '@/components/navbar';
import { ThemeProvider } from '@/components/theme-provider';
import type { Metadata } from 'next';
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
  title: 'ShipYard',
  description: 'Deploy your any frontend app with ease',
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
          <Grain />
          <Toaster richColors position="bottom-right" />
          <AuthGuard>
            <Navbar />
            <main className="flex-1">{children}</main>
            {/* <Footer /> */}
          </AuthGuard>
        </ThemeProvider>
      </body>
    </html>
  );
}
