'use client';

import React from 'react';
import { CalendarDays } from 'lucide-react';

import { cardVariantClass } from '@/components/builder/FormThemeScope';
import { cn } from '@/lib/utils';
import type { FormTheme } from '@/types/form';
import type { AppMastheadStyle } from './appearance';

/**
 * The header of a public app.
 *
 * Four treatments of the same four facts — logo, title, reporting period,
 * description — because this is the part of the page a respondent sees before
 * they scroll, and it is doing most of the work of making one programme feel
 * unlike another.
 *
 * Extracted from `AppRunnerClient`, where it was inlined and therefore had
 * exactly one form no matter what the author configured.
 */

export interface MastheadBranding {
  headerTitle?: string;
  footerText?: string;
  logoUrl?: string;
  coverImageUrl?: string;
}

export interface AppMastheadProps {
  variant: AppMastheadStyle;
  theme: FormTheme;
  title: string;
  description: string | null;
  branding: MastheadBranding;
  organizationLogoUrl: string | null;
  period: { label: string; startsAt: string; endsAt: string } | null;
  className?: string;
}

/** The period pill. Identical in every variant; only its surroundings change. */
function PeriodBadge({ label, tone }: { label: string; tone: 'muted' | 'onPrimary' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
        tone === 'onPrimary'
          ? 'bg-[var(--primary-foreground)]/15 text-[var(--primary-foreground)]'
          : 'border border-border bg-muted text-muted-foreground',
      )}
    >
      <CalendarDays className="size-3.5" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Author-supplied URLs pointing at any host, so a plain `<img>`: the image
 * optimiser refuses a remote host without an allowlist entry, and an app's logo
 * is not worth a deployment change per organization.
 */
function Logo({ src, className }: { src: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={cn('w-auto object-contain', className)} />;
}

export function AppMasthead({
  variant,
  theme,
  title,
  description,
  branding,
  organizationLogoUrl,
  period,
  className,
}: AppMastheadProps) {
  const logoUrl = branding.logoUrl || organizationLogoUrl || null;
  const cover = branding.coverImageUrl;

  // `hero` is the only variant that REQUIRES an asset. Falling through to
  // `gradient` rather than rendering an empty grey band means an author can
  // pick it before uploading the image and get something deliberate-looking in
  // the meantime, instead of a layout that looks broken.
  const resolved: AppMastheadStyle = variant === 'hero' && !cover ? 'gradient' : variant;

  // ── Slim bar ─────────────────────────────────────────────────────────────
  // No card, no cover: a single row and a line under it. For dense, desk-bound
  // apps where the header is a label rather than a front door.
  if (resolved === 'bar') {
    return (
      <header className={cn('border-b border-border pb-4', className)}>
        <div className="flex flex-wrap items-center gap-3">
          {logoUrl && <Logo src={logoUrl} className="h-7" />}
          <h1 className="min-w-0 flex-1 text-lg font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {period && <PeriodBadge label={period.label} tone="muted" />}
        </div>
        {description && (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </header>
    );
  }

  // ── Cover image ──────────────────────────────────────────────────────────
  // Title sits ON the image, so it needs a scrim: a photograph is arbitrary and
  // white text over a bright sky is unreadable. Fixed light text rather than
  // the theme's, because the gradient below is always dark.
  if (resolved === 'hero') {
    return (
      <header
        className={cn(
          'relative isolate overflow-hidden rounded-[var(--radius)]',
          cardVariantClass(theme.cardVariant),
          className,
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover} alt="" className="h-56 w-full object-cover sm:h-72" loading="eager" />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/5"
        />
        <div className="absolute inset-x-0 bottom-0 space-y-2 p-6 sm:p-7">
          {logoUrl && <Logo src={logoUrl} className="h-10 rounded-lg bg-white/90 p-1.5" />}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-white drop-shadow sm:text-3xl">
              {title}
            </h1>
            {period && (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                <CalendarDays className="size-3.5" aria-hidden />
                {period.label}
              </span>
            )}
          </div>
          {description && (
            <p className="max-w-2xl whitespace-pre-line text-sm leading-relaxed text-white/85">
              {description}
            </p>
          )}
        </div>
      </header>
    );
  }

  // ── Colour wash ──────────────────────────────────────────────────────────
  // The brand colour as a band, with the description on the card below it, so
  // the app is recognisable at a glance without needing an uploaded asset.
  // `--primary-foreground` is luminance-picked upstream, so the title stays
  // legible even against a pale brand colour.
  if (resolved === 'gradient') {
    return (
      <header
        className={cn(
          'overflow-hidden rounded-[var(--radius)] bg-card',
          cardVariantClass(theme.cardVariant),
          className,
        )}
      >
        <div className="bg-gradient-to-br from-[var(--primary)] to-[color-mix(in_srgb,var(--primary)_62%,black)] p-6 sm:p-7">
          {logoUrl && <Logo src={logoUrl} className="mb-3 h-10 rounded-lg bg-white/90 p-1.5" />}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-[var(--primary-foreground)] sm:text-[1.75rem]">
              {title}
            </h1>
            {period && <PeriodBadge label={period.label} tone="onPrimary" />}
          </div>
        </div>
        {description && (
          <p className="whitespace-pre-line px-6 py-5 text-sm leading-relaxed text-muted-foreground sm:px-7">
            {description}
          </p>
        )}
      </header>
    );
  }

  // ── Plain card (the original) ────────────────────────────────────────────
  return (
    <header
      className={cn(
        'overflow-hidden rounded-[var(--radius)] bg-card',
        cardVariantClass(theme.cardVariant),
        className,
      )}
    >
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="h-36 w-full object-cover sm:h-44" loading="eager" />
      )}

      <div className={cn('space-y-3 p-6 sm:p-7', logoUrl && cover && 'pt-0')}>
        {logoUrl && (
          <Logo
            src={logoUrl}
            className={cn('h-11', cover && '-mt-9 rounded-lg bg-card p-1.5 shadow-sm')}
          />
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-[1.75rem]">
            {title}
          </h1>
          {period && <PeriodBadge label={period.label} tone="muted" />}
        </div>

        {description && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
    </header>
  );
}
