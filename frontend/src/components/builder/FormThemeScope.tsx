'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { FormTheme } from '@/types/form';

/**
 * Applies a form's theme to everything inside it.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `themeConfig` was written on save, copied into every published FormVersion,
 * returned by the public endpoint — and then ignored. `FormRunner` contained no
 * reference to `form.theme` at all, so every public form rendered in the app's
 * own slate palette no matter what the author picked. Presets, colours, cover
 * images: all stored, all published, none visible.
 *
 * ── How it works ───────────────────────────────────────────────────────────
 * Rather than thread colours through props into every control, this overrides
 * the design-token CSS variables on a wrapper element. The runner is already
 * written in terms of `bg-card`, `text-foreground`, `bg-primary`, `border-border`
 * and friends, so redefining those variables restyles the whole subtree with no
 * changes to the markup — and anything added to the runner later is themed
 * automatically instead of having to remember to pass a colour to it.
 *
 * Tokens the author does not control are *derived* from the ones they do:
 * muted text, borders and hover fills are mixes of the text colour over the
 * card, so a dark theme gets light borders without the author configuring six
 * more colours. `--primary-foreground` is picked by luminance, because a light
 * brand colour with white label text is unreadable and authors pick light
 * brand colours all the time.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Colour parsing
//
// Values come from a colour input (`#rrggbb`), from a hand-typed hex, or from a
// preset — and one preset ('glass') ships an `rgba()` string. Anything that
// cannot be parsed is passed through untouched and simply does not participate
// in the derived tokens.
// ─────────────────────────────────────────────────────────────────────────────

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string | undefined): Rgb | null {
  if (!value) return null;
  const input = value.trim();

  const hex = input.match(/^#([0-9a-f]{3,8})$/i)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a] = hex.split('').map((c) => parseInt(c + c, 16));
      return { r, g, b, a: hex.length === 4 ? a / 255 : 1 };
    }
    if (hex.length === 6 || hex.length === 8) {
      const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) / 255 : 1 };
    }
    return null;
  }

  const rgb = input.match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (rgb) {
    const parts = rgb.split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
    }
  }

  return null;
}

function rgba({ r, g, b }: Rgb, alpha: number) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Blend `top` over `bottom` at `alpha`, so borders stay opaque and predictable. */
function mix(top: Rgb, bottom: Rgb, alpha: number): string {
  const c = (t: number, b: number) => Math.round(t * alpha + b * (1 - alpha));
  return `rgb(${c(top.r, bottom.r)}, ${c(top.g, bottom.g)}, ${c(top.b, bottom.b)})`;
}

/** Relative luminance, WCAG definition. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Black or white, whichever is legible on `background`.
 *
 * A fixed white label breaks the moment someone picks a yellow or lime brand
 * colour — which the colour picker makes very easy to do.
 */
function readableOn(background: Rgb): string {
  return luminance(background) > 0.5 ? '#111111' : '#ffffff';
}

const RADIUS_REM: Record<NonNullable<FormTheme['borderRadius']>, string> = {
  none: '0rem',
  sm: '0.25rem',
  md: '0.5rem',
  lg: '1rem',
  full: '1.75rem',
};

/**
 * Font stacks.
 *
 * The families are declared with `next/font` in the public route, which exposes
 * them as CSS variables; the fallbacks keep the builder's preview honest even
 * where those variables are not defined.
 */
const FONT_STACKS: Record<NonNullable<FormTheme['fontFamily']>, string> = {
  Inter: 'var(--font-form-inter), Inter, ui-sans-serif, system-ui, sans-serif',
  Roboto: 'var(--font-form-roboto), Roboto, ui-sans-serif, system-ui, sans-serif',
  Outfit: 'var(--font-form-outfit), Outfit, ui-sans-serif, system-ui, sans-serif',
  'Plus Jakarta Sans':
    'var(--font-form-jakarta), "Plus Jakarta Sans", ui-sans-serif, system-ui, sans-serif',
};

export function buildThemeStyle(theme: FormTheme | undefined): React.CSSProperties {
  const t = theme ?? ({} as FormTheme);

  const background = parseColor(t.backgroundColor) ?? { r: 248, g: 250, b: 252, a: 1 };
  const card = parseColor(t.cardColor) ?? { r: 255, g: 255, b: 255, a: 1 };
  const text = parseColor(t.textColor) ?? { r: 24, g: 24, b: 27, a: 1 };
  const primary = parseColor(t.primaryColor) ?? { r: 79, g: 70, b: 229, a: 1 };

  // Derived tokens are mixed against the card, since that is what they sit on.
  const style: Record<string, string> = {
    '--background': t.backgroundColor || 'rgb(248, 250, 252)',
    '--foreground': t.textColor || 'rgb(24, 24, 27)',
    '--card': t.cardColor || 'rgb(255, 255, 255)',
    '--card-foreground': t.textColor || 'rgb(24, 24, 27)',
    '--popover': t.cardColor || 'rgb(255, 255, 255)',
    '--popover-foreground': t.textColor || 'rgb(24, 24, 27)',

    '--primary': t.primaryColor || 'rgb(79, 70, 229)',
    '--primary-foreground': readableOn(primary),
    '--ring': rgba(primary, 0.5),

    '--secondary': mix(text, card, 0.06),
    '--secondary-foreground': t.textColor || 'rgb(24, 24, 27)',
    '--accent': mix(text, card, 0.06),
    '--accent-foreground': t.textColor || 'rgb(24, 24, 27)',

    '--muted': mix(text, card, 0.05),
    // 62% is where secondary text stays comfortably above 4.5:1 against the
    // card for both light and dark themes.
    '--muted-foreground': mix(text, card, 0.62),

    '--border': mix(text, card, 0.14),
    '--border-strong': mix(text, card, 0.24),
    '--input': mix(text, card, 0.2),

    '--radius': RADIUS_REM[t.borderRadius ?? 'md'],

    backgroundColor: t.backgroundColor || 'rgb(248, 250, 252)',
    color: t.textColor || 'rgb(24, 24, 27)',
    fontFamily: FONT_STACKS[t.fontFamily ?? 'Inter'] ?? FONT_STACKS.Inter,
  };

  // Unused today but kept honest: a theme whose page background is dark should
  // not inherit light-mode shadows from the surrounding app.
  style['--shadow-card'] =
    luminance(background) < 0.4
      ? '0 1px 2px rgba(0,0,0,.6)'
      : '0 1px 2px rgba(16,24,40,.06)';

  return style as React.CSSProperties;
}

/** Card chrome for the four `cardVariant` values. */
export function cardVariantClass(variant: FormTheme['cardVariant'] | undefined): string {
  switch (variant) {
    case 'elevated':
      return 'border-transparent shadow-[0_12px_32px_-8px_rgba(0,0,0,.22)]';
    case 'glass':
      return 'border-white/25 bg-card/70 shadow-[0_8px_32px_-8px_rgba(0,0,0,.18)] backdrop-blur-xl';
    case 'minimal':
      return 'border-transparent bg-transparent shadow-none';
    case 'card':
    default:
      return 'border-border shadow-sm';
  }
}

interface FormThemeScopeProps {
  theme?: FormTheme;
  children: React.ReactNode;
  className?: string;
  /** Paint the scope's own background. Off inside a dialog, which has its own. */
  paintBackground?: boolean;
  /** Merged last, so a caller can reinstate a background the scope dropped. */
  style?: React.CSSProperties;
}

export function FormThemeScope({
  theme,
  children,
  className,
  paintBackground = true,
  style: styleOverride,
}: FormThemeScopeProps) {
  const themeStyle = useMemo(() => buildThemeStyle(theme), [theme]);

  const style = useMemo(
    () => ({
      ...themeStyle,
      // Inside a dialog the surrounding surface is already painted; repainting
      // it here would put an opaque rectangle over the dialog's own chrome.
      ...(paintBackground ? {} : { backgroundColor: 'transparent' }),
      ...styleOverride,
    }),
    [themeStyle, paintBackground, styleOverride],
  );

  return (
    <div
      data-form-theme={theme?.preset ?? 'custom'}
      style={style}
      className={cn('[color-scheme:normal]', className)}
    >
      {children}
    </div>
  );
}
