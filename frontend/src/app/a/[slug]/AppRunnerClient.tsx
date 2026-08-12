'use client';

import React from 'react';
import { CalendarDays, LogIn } from 'lucide-react';

import { AppRunner, type AppSummary } from '@/components/apps/AppRunner';
import { AppMasthead } from '@/components/apps/AppMasthead';
import { DENSITY, WIDTH_CLASS, readAppearance, textureStyle } from '@/components/apps/appearance';
import { FormThemeScope, cardVariantClass } from '@/components/builder/FormThemeScope';
import { cn } from '@/lib/utils';
import type { FormTheme } from '@/types/form';
import { formFontVariables } from '../../f/[id]/fonts';

/**
 * The themed shell around a public app.
 *
 * Where a single form is one document, an app is a programme with its own
 * identity — so the masthead treatment, the spacing and the page decoration are
 * all author-chosen here rather than fixed. See `components/apps/appearance.ts`
 * for what the choices are and why they live in `themeConfig`.
 *
 * The form CONTROLS are deliberately untouched by any of it: fields render
 * through `FormRunner`, shared with public single forms, so an input looks the
 * same everywhere and there is no second implementation to drift.
 */
export function AppRunnerClient({ slug, app }: { slug: string; app: AppSummary & { theme?: FormTheme } }) {
  const theme: FormTheme = (app.theme ?? {}) as FormTheme;
  const branding = app.branding ?? {};

  const appearance = readAppearance(theme);
  const density = DENSITY[appearance.density];

  // Passed to the theme scope, which merges caller styles last — so the texture
  // sits on top of the background colour the scope paints rather than fighting
  // it for the same declaration.
  const texture = textureStyle(appearance.texture, theme.cardVariant);

  return (
    <FormThemeScope
      theme={theme}
      className={cn('min-h-screen', formFontVariables)}
      style={texture}
    >
      {/* The width is the author's choice now, not a consequence of the layout
          mode. It used to be derived — 42rem stacked, 64rem for GRID — which
          meant the only way to widen a page was to switch it to two columns,
          coupling two decisions that have nothing to do with each other. Every
          value is a `max-w-*`, so a phone is unaffected either way. */}
      <div className={cn('mx-auto w-full', density.page, WIDTH_CLASS[appearance.width])}>
        <AppMasthead
          variant={appearance.masthead}
          theme={theme}
          title={branding.headerTitle || app.name}
          description={app.description}
          branding={branding}
          organizationLogoUrl={app.organization?.logoUrl ?? null}
          period={app.period}
          className={density.masthead}
        />

        {/* Stated up front rather than discovered at submit: the session
            endpoint enforces it, and filling a whole report before being told
            to sign in is the worst possible order to learn this. */}
        {app.requireAuth && (
          <div
            role="status"
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-border bg-card p-4 text-sm',
              density.masthead,
            )}
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
          <AppRunner publicSlug={slug} app={app} appearance={appearance} />
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
