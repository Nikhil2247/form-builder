import React from 'react';
import Link from 'next/link';

import { GridPattern } from '@/components/marketing/primitives';

interface LegalLayoutProps {
  children: React.ReactNode;
  title: string;
  lastUpdated: string;
}

export function LegalLayout({ children, title, lastUpdated }: LegalLayoutProps) {
  const links = [
    { name: 'Terms and Conditions', href: '/terms' },
    { name: 'Privacy Policy', href: '/privacy' },
    { name: 'Security', href: '/compliance' },
  ];

  return (
    <div className="relative flex min-h-screen flex-col bg-background pb-24 font-sans">
      {/* Header. Carries the same grid texture as the rest of the public site
          so a legal page reads as part of it rather than as a plain document
          someone forgot to style. */}
      <section className="relative isolate overflow-hidden border-b border-border/60 bg-muted/40 pb-16 pt-24">
        <GridPattern fade="top" />
        <div className="container relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <h1 className="font-display mb-4 text-4xl font-bold tracking-tight text-foreground md:text-5xl">
            {title}
          </h1>
          <p className="text-muted-foreground">Last updated: {lastUpdated}</p>
        </div>
      </section>

      {/* Main Content */}
      <section className="pt-12">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl flex flex-col md:flex-row gap-12">
          
          {/* Sidebar Nav */}
          <div className="w-full md:w-64 shrink-0">
            <div className="sticky top-24 space-y-1 bg-card rounded-2xl border border-border p-3 shadow-sm">
              {links.map(link => (
                <Link 
                  key={link.href} 
                  href={link.href}
                  className="block px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {link.name}
                </Link>
              ))}
            </div>
          </div>

          {/* Document Content */}
          <div className="flex-1 max-w-3xl">
            <div className="prose prose-slate dark:prose-invert prose-headings:font-bold prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-p:text-muted-foreground prose-p:leading-relaxed max-w-none">
              {children}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
