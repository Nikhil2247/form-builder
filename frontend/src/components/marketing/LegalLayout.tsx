import React from 'react';
import Link from 'next/link';

interface LegalLayoutProps {
  children: React.ReactNode;
  title: string;
  lastUpdated: string;
}

export function LegalLayout({ children, title, lastUpdated }: LegalLayoutProps) {
  const links = [
    { name: 'Terms & Conditions', href: '/terms' },
    { name: 'Privacy Policy', href: '/privacy' },
    { name: 'Security & Compliance', href: '/compliance' }
  ];

  return (
    <div className="flex flex-col relative font-sans bg-background min-h-screen pb-24">
      {/* Header */}
      <section className="pt-24 pb-16 bg-muted/30 border-b border-border/50">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-6xl">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-foreground">
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
