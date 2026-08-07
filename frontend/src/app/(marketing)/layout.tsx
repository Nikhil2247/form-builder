import React from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground selection:bg-primary/20">
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <Layers size={18} strokeWidth={2.5} />
            </div>
            <span className="font-bold text-lg tracking-tight">Formora</span>
          </Link>
          
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted-foreground">
            <Link href="/features" className="hover:text-foreground transition-colors">Features</Link>
            <Link href="/form-templates" className="hover:text-foreground transition-colors">Templates</Link>
            <Link href="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
          </nav>
          
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <Link href="/login" className="hidden sm:inline-flex text-sm font-medium hover:text-primary transition-colors">
              Log in
            </Link>
            <Link href="/signup" className={buttonVariants({ variant: 'default', size: 'sm' })}>
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>

      <footer className="border-t border-border bg-background py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-slate-900 flex items-center justify-center text-white">
                <Layers size={18} strokeWidth={2.5} />
              </div>
              <span className="font-bold tracking-tight">Formora</span>
            </div>
            <div className="text-sm text-muted-foreground max-w-xs">
              The modern form builder for teams who care about design and conversions.
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 gap-8 text-sm">
            <div className="flex flex-col gap-3">
              <span className="font-semibold text-foreground">Product</span>
              <Link href="/features" className="text-muted-foreground hover:text-foreground">Features</Link>
              <Link href="/form-templates" className="text-muted-foreground hover:text-foreground">Templates</Link>
              <Link href="/pricing" className="text-muted-foreground hover:text-foreground">Pricing</Link>
            </div>
            <div className="flex flex-col gap-3">
              <span className="font-semibold text-foreground">Company</span>
              <Link href="/about" className="text-muted-foreground hover:text-foreground">About</Link>
              <Link href="/contact" className="text-muted-foreground hover:text-foreground">Contact</Link>
              <Link href="/blog" className="text-muted-foreground hover:text-foreground">Blog</Link>
            </div>
            <div className="flex flex-col gap-3">
              <span className="font-semibold text-foreground">Legal</span>
              <Link href="/terms" className="text-muted-foreground hover:text-foreground">Terms</Link>
              <Link href="/privacy" className="text-muted-foreground hover:text-foreground">Privacy</Link>
              <Link href="/compliance" className="text-muted-foreground hover:text-foreground">Compliance</Link>
            </div>
          </div>
        </div>
        <div className="container mx-auto px-4 sm:px-6 lg:px-8 mt-16 pt-8 border-t border-border/50 text-sm text-muted-foreground flex flex-col md:flex-row justify-between items-center">
          <span>© {new Date().getFullYear()} Formora Inc. All rights reserved.</span>
          <div className="flex gap-4 mt-4 md:mt-0">
            <a href="#" className="hover:text-foreground">Twitter</a>
            <a href="#" className="hover:text-foreground">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
