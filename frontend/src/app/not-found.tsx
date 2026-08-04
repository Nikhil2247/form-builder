'use client';

import Link from 'next/link';
import { FileQuestion, Home, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-6 text-center">
      {/* Icon */}
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-muted">
        <FileQuestion size={36} className="text-muted-foreground" />
      </div>

      {/* Error code */}
      <div className="mb-2 text-8xl font-black text-foreground/10 select-none">404</div>

      {/* Message */}
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">Page Not Found</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist, has been moved, or you don&apos;t have permission to access it.
      </p>

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
        >
          <Home size={15} />
          Go to Dashboard
        </Link>
        <button
          onClick={() => window.history.back()}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
        >
          <ArrowLeft size={15} />
          Go Back
        </button>
      </div>
    </div>
  );
}
