'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The single page-title treatment.
 *
 * Every dashboard page previously hand-rolled its own header — different type
 * scales (text-xl vs text-2xl), different border weights, some with a back
 * button and some without. This is the one implementation; pages supply
 * content, not layout.
 */

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Renders a back affordance. `true` uses router.back(); a string navigates. */
  back?: boolean | string;
  breadcrumbs?: Breadcrumb[];
  /** Status chip or similar, rendered inline after the title. */
  badge?: React.ReactNode;
  /** Buttons, right-aligned. */
  actions?: React.ReactNode;
  /** Tabs or filters that belong to the header block. */
  children?: React.ReactNode;
  className?: string;
  isLoading?: boolean;
}

export function PageHeader({
  title,
  description,
  back,
  breadcrumbs,
  badge,
  actions,
  children,
  className,
  isLoading,
}: PageHeaderProps) {
  const router = useRouter();

  if (isLoading) {
    return (
      <div className={cn('space-y-3 border-b border-border pb-5', className)}>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
    );
  }

  return (
    <header className={cn('space-y-4 border-b border-border pb-5', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {breadcrumbs.map((crumb, i) => (
              <li key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden className="text-border-strong">/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="rounded-sm hover:text-foreground">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {back && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="mt-0.5 shrink-0"
              aria-label="Go back"
              onClick={() => (typeof back === 'string' ? router.push(back) : router.back())}
            >
              <ArrowLeft className="size-4" />
            </Button>
          )}

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {title}
              </h1>
              {badge}
            </div>
            {description && (
              // A `div`, not a `p`: the form detail page passes a `RichText`
              // node here, and that renders block elements (`<ul>`, `<p>`) —
              // invalid inside a `<p>` and a React hydration mismatch.
              <div className="mt-1 text-sm text-muted-foreground">{description}</div>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {children}
    </header>
  );
}

/**
 * Standard page shell: constrains width, sets vertical rhythm, and provides the
 * landmark the skip-link targets.
 */
export function PageShell({
  children,
  className,
  width = 'default',
}: {
  children: React.ReactNode;
  className?: string;
  width?: 'default' | 'wide' | 'narrow';
}) {
  return (
    <div
      id="main-content"
      className={cn(
        'mx-auto w-full space-y-6',
        width === 'narrow' && 'max-w-3xl',
        width === 'default' && 'max-w-[1400px]',
        className,
      )}
    >
      {children}
    </div>
  );
}
