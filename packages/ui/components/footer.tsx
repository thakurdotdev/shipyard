'use client';

import { FooterWordmark } from '@/components/footer-wordmark';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Global footer.
 *
 * Structure: a hairline divider lit at its centre, a brand block with the
 * product tagline, and an oversized, barely-visible wordmark anchored to the
 * bottom and cropped by the container's overflow.
 *
 * Mounted from the root layout. AuthGuard renders its children on public routes
 * too (which is why the navbar shows on /login), so the footer gates itself the
 * same way to keep the sign-in screen free of chrome.
 */
export function Footer() {
  const pathname = usePathname();

  if (pathname === '/login') {
    return null;
  }

  return (
    <footer className="relative mt-24 overflow-hidden">
      <div className="divider-glow" />

      <div className="mx-auto max-w-[1400px] px-6 pt-16">
        <div className="flex flex-col justify-between gap-10 md:flex-row md:items-start">
          <div className="max-w-sm">
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 text-base font-bold tracking-tight"
            >
              <Image src="/logo.png" alt="Logo" width={30} height={30} className="rounded-lg" />
              ShipYard
            </Link>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Self-hosted platform-as-a-service for modern web applications — build, deploy and
              manage your projects with ease.
            </p>
            <p className="mt-6 text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
              A product by Pankaj
            </p>
          </div>

          <p className="text-sm text-muted-foreground md:text-right">
            © ShipYard · All rights reserved.
          </p>
        </div>
      </div>

      {/* Giant faded wordmark. Sinks below the footer's clipped edge and surfaces
          letter-by-letter as the page scrolls (see FooterWordmark), with one
          solid brand accent sitting on its baseline. */}
      <FooterWordmark />
    </footer>
  );
}
