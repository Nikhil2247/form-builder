'use client';

import React from 'react';
import { CalendarDays, LogIn } from 'lucide-react';

import { AppRunner, type AppSummary } from '@/components/apps/AppRunner';
import { FormThemeScope, cardVariantClass } from '@/components/builder/FormThemeScope';
import { cn } from '@/lib/utils';
import type { FormTheme } from '@/types/form';
import { formFontVariables } from '../../f/[id]/fonts';

/**
 * The themed shell around a public app.
 *
 * Mirrors the public form page deliberately — same theme scope, same measure,
 * same header/footer rhythm — so an organization running both does not present
 * respondents with two different products.
 */
export function AppRunnerClient({ slug, app }: { slug: string; app: AppSummary & { theme?: FormTheme } }) {
  const theme: FormTheme = (app.theme ?? {}) as FormTheme;
  const branding = app.branding ?? {};
  const logoUrl = branding.logoUrl || app.organization?.logoUrl || null;

  const period = app.period
    ? `${new Date(app.period.startsAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })} – ${new Date(app.period.endsAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
    : null;

  return (
    <FormThemeScope theme={theme} className={cn('min-h-screen', formFontVariables)}>
      {/* Widened for GRID, same reasoning as the public form page: two columns
          inside 42rem give each field less room than the controls already use,
          so the layout costs a column and buys nothing. Both widths still
          collapse to one column below `md`, so a phone is unaffected. */}
      <div
        className={cn(
          'mx-auto w-full px-4 py-8 sm:px-6 sm:py-12',
          app.config?.layoutMode === 'GRID' ? 'max-w-5xl' : 'max-w-2xl',
        )}
      >
        {/* ── Masthead ─────────────────────────────────────────────────── */}
        <div
          className={cn(
            'mb-6 overflow-hidden rounded-[var(--radius)] bg-card',
            cardVariantClass(theme.cardVariant),
          )}
        >
          {branding.coverImageUrl && (
            // A plain <img>: the URL is author-supplied and can point at any
            // host, which the image optimiser refuses without an allowlist entry.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={branding.coverImageUrl}
              alt=""
              className="h-36 w-full object-cover sm:h-44"
              loading="eager"
            />
          )}

          <div className={cn('space-y-3 p-6 sm:p-7', logoUrl && branding.coverImageUrl && 'pt-0')}>
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className={cn(
                  'h-11 w-auto object-contain',
                  branding.coverImageUrl ? '-mt-9 rounded-lg bg-card p-1.5 shadow-sm' : '',
                )}
              />
            )}

            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-[1.75rem]">
                {branding.headerTitle || app.name}
              </h1>
              {period && (
                <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <CalendarDays className="size-3.5" aria-hidden />
                  {app.period?.label ?? period}
                </span>
              )}
            </div>

            {app.description && (
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {app.description}
              </p>
            )}
          </div>
        </div>

        {/* Stated up front rather than discovered at submit: the session
            endpoint enforces it, and filling a whole report before being told
            to sign in is the worst possible order to learn this. */}
        {app.requireAuth && (
          <div
            role="status"
            className="mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-4 text-sm"
          >
            <LogIn className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex-1 text-muted-foreground">
              This app only accepts reports from signed-in users.
            </span>
            <a
              href={`/login?next=${encodeURIComponent(`/a/${slug}`)}`}
              className="font-semibold text-primary underline underline-offset-4"
            >
              Sign in
            </a>
          </div>
        )}

        {app.isOutsidePeriod ? (
          <div
            role="status"
            className={cn('rounded-[var(--radius)] bg-card p-8 text-center', cardVariantClass(theme.cardVariant))}
          >
            <CalendarDays className="mx-auto mb-3 size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">
              This app is between reporting periods
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Reports are accepted only during an open period. Please check back.
            </p>
          </div>
        ) : (
          <AppRunner publicSlug={slug} app={app} />
        )}

        <footer className="mt-10 border-t border-border pt-5 text-center">
          <p className="text-xs text-muted-foreground">
            {branding.footerText ||
              (app.organization?.name ? `A programme from ${app.organization.name}` : '')}
          </p>
        </footer>
      </div>
    </FormThemeScope>
  );
}
