import React from 'react';
import Link from 'next/link';

import { PublicHeader } from '@/components/marketing/PublicHeader';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/20">
      <PublicHeader />

      <main className="flex-1">
        {children}
      </main>

      {/* Every link here resolves. The previous footer advertised a /blog that
          does not exist and two `href="#"` social links that went nowhere —
          three dead ends in the one place on the page a visitor goes when they
          are looking for something specific. */}
      <footer className="border-t border-border bg-background py-16">
        <div className="container mx-auto flex flex-col justify-between gap-10 px-4 sm:px-6 md:flex-row lg:px-8">
          <div className="flex max-w-xs flex-col gap-4">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image's
                  optimizer 400s on local SVGs unless `dangerouslyAllowSVG` is set;
                  not worth loosening for a static decorative logotype. */}
              <img
                src="/logos/impactlens-icon-small.svg"
                alt=""
                width={32}
                height={32}
                className="size-8 rounded-xl"
              />
              <span className="font-display font-bold tracking-tight">ImpactLens</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Forms with a rules engine, managed reference data and versioned publishing — for
              teams whose answers have to hold up afterwards.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 text-sm md:grid-cols-3">
            <div className="flex flex-col gap-3">
              <span className="font-semibold text-foreground">Product</span>
              <Link href="/features" className="text-muted-foreground hover:text-foreground">Features</Link>
              <Link href="/form-templates" className="text-muted-foreground hover:text-foreground">Templates</Link>
              <Link href="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
              <Link href="/docs" className="text-muted-foreground hover:text-foreground">Documentation</Link>
            </div>
            <div className="flex flex-col gap-3">
              <span className="font-semibold text-foreground">Learn</span>
              <Link href="/docs/quickstart" className="text-muted-foreground hover:text-foreground">Quickstart</Link>
              <Link href="/docs/concepts" className="text-muted-foreground hover:text-foreground">Core concepts</Link>
              <Link href="/docs/apps" className="text-muted-foreground hover:text-foreground">Data apps</Link>
              <Link href="/about" className="text-muted-foreground hover:text-foreground">About</Link>
            </div>
            <div className="flex flex-col gap-3">
              <span className="font-semibold text-foreground">Company</span>
              <Link href="/contact" className="text-muted-foreground hover:text-foreground">Contact</Link>
              <Link href="/terms" className="text-muted-foreground hover:text-foreground">Terms</Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-foreground">Privacy</Link>
              <Link href="/compliance" className="text-muted-foreground hover:text-foreground">Security</Link>
            </div>
          </div>
        </div>

        <div className="container mx-auto mt-16 flex flex-col items-center justify-between gap-4 border-t border-border/50 px-4 pt-8 text-sm text-muted-foreground sm:px-6 md:flex-row lg:px-8">
          <span>© {new Date().getFullYear()} ImpactLens. All rights reserved.</span>
          <div className="flex gap-6">
            <Link href="/login" className="hover:text-foreground">Sign in</Link>
            <Link href="/signup" className="hover:text-foreground">Create a workspace</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
