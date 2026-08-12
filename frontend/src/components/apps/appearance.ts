import type { CSSProperties } from 'react';

import type { FormTheme } from '@/types/form';

/**
 * How a public app is laid out and dressed, beyond its palette.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The problem this solves ────────────────────────────────────────────────
 * The theme system varies TOKENS and never STRUCTURE. `buildThemeStyle` emits
 * colours, radius, font and shadow; `cardVariantClass` offers four card
 * treatments. Everything else — a centred column, a masthead card, a stack of
 * bordered step sections, a submit card — was hardcoded, so two apps with
 * completely different palettes were the same DOM in different colours. Five
 * demo apps with five distinct colour schemes still read as one product with a
 * theme picker.
 *
 * These are the knobs that change the shape rather than the shade.
 *
 * ── Why the keys are flat ──────────────────────────────────────────────────
 * They live inside `themeConfig`, which is free-form JSONB — no migration, no
 * API change. But `normalizeFormStructure`'s `normalizeTheme` keeps strings,
 * numbers and booleans and `continue`s past everything else, so a nested
 * `appearance: { shell: 'wizard' }` object is silently DROPPED on save. It
 * would appear to work in the settings panel and be gone on reload. Hence five
 * top-level scalar keys, deliberately prefixed so they cannot collide with a
 * colour token.
 *
 * ── Why every value is re-validated on read ────────────────────────────────
 * `normalizeTheme` lets any string through — it has no idea these keys mean
 * anything. A hand-edited row, or an app themed by an older build, can hold
 * `appShell: "whatever"`. Anything unrecognised falls back to the default
 * rather than reaching a `switch` that renders nothing.
 */

export type AppShell = 'document' | 'wizard' | 'console' | 'mobile';
export type AppMastheadStyle = 'plain' | 'gradient' | 'hero' | 'bar';
export type AppStepStyle = 'bordered' | 'timeline' | 'accordion' | 'plain';
export type AppDensity = 'compact' | 'comfortable' | 'spacious';
export type AppTexture = 'none' | 'dots' | 'grid' | 'mesh' | 'accentBar';
export type AppWidth = 'narrow' | 'medium' | 'wide' | 'full';

export interface AppAppearance {
  shell: AppShell;
  masthead: AppMastheadStyle;
  stepStyle: AppStepStyle;
  density: AppDensity;
  texture: AppTexture;
  width: AppWidth;
}

export const APP_APPEARANCE_DEFAULTS: AppAppearance = {
  shell: 'document',
  masthead: 'plain',
  stepStyle: 'bordered',
  density: 'comfortable',
  texture: 'none',
  /**
   * Wider than the 42rem the page used to be pinned to.
   *
   * That measure is right for a single form — it is a document, and a reading
   * measure suits it. An app is a work surface: several steps, repeatable
   * entries, and on a large screen the old width left most of the display empty
   * while the content sat in a narrow ribbon. `wide` is also within a rem of
   * what GRID apps already used, so the layout that most needed the room keeps
   * exactly the room it had.
   */
  width: 'wide',
};

export const APP_SHELLS: readonly AppShell[] = ['document', 'wizard', 'console', 'mobile'];

/**
 * The shells that are actually built, and therefore the only ones offered.
 *
 * `AppShell` names the whole intended set so a stored `console` from a later
 * build round-trips instead of being rewritten to `document` by an older one —
 * but the settings panel must not offer a choice that silently does nothing.
 * Move a value here when its layout lands, not before.
 */
export const APP_SHELLS_AVAILABLE: readonly AppShell[] = ['document', 'wizard'];
export const APP_MASTHEADS: readonly AppMastheadStyle[] = ['plain', 'gradient', 'hero', 'bar'];
export const APP_STEP_STYLES: readonly AppStepStyle[] = [
  'bordered',
  'timeline',
  'accordion',
  'plain',
];
export const APP_DENSITIES: readonly AppDensity[] = ['compact', 'comfortable', 'spacious'];
export const APP_TEXTURES: readonly AppTexture[] = ['none', 'dots', 'grid', 'mesh', 'accentBar'];
export const APP_WIDTHS: readonly AppWidth[] = ['narrow', 'medium', 'wide', 'full'];

/**
 * How much of a large screen the app fills.
 *
 * Only an upper bound — every value is `max-w-*`, so a phone is unaffected by
 * the choice and the page is fluid until it hits the cap.
 */
export const WIDTH_CLASS: Record<AppWidth, string> = {
  narrow: 'max-w-2xl',
  medium: 'max-w-4xl',
  wide: 'max-w-6xl',
  full: 'max-w-[96rem]',
};

/** The stored value if it is one this build knows, otherwise the fallback. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Read the appearance out of a theme blob. Total — never throws, never null. */
export function readAppearance(theme: FormTheme | null | undefined): AppAppearance {
  const t = (theme ?? {}) as Partial<FormTheme>;
  return {
    shell: oneOf(t.appShell, APP_SHELLS, APP_APPEARANCE_DEFAULTS.shell),
    masthead: oneOf(t.appMasthead, APP_MASTHEADS, APP_APPEARANCE_DEFAULTS.masthead),
    stepStyle: oneOf(t.appStepStyle, APP_STEP_STYLES, APP_APPEARANCE_DEFAULTS.stepStyle),
    density: oneOf(t.appDensity, APP_DENSITIES, APP_APPEARANCE_DEFAULTS.density),
    texture: oneOf(t.appTexture, APP_TEXTURES, APP_APPEARANCE_DEFAULTS.texture),
    width: oneOf(t.appWidth, APP_WIDTHS, APP_APPEARANCE_DEFAULTS.width),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Density
//
// A lookup table of class strings rather than computed spacing, because the
// values are design decisions and want to be read and tuned as such.
//
// `card` sets `--card-spacing` ON the Card element and not on an ancestor: the
// component declares `[--card-spacing:--spacing(4)]` on itself, and a property
// set directly on an element beats one inherited from above, so a scope-level
// override would have no effect at all.
//
// SCOPE, honestly stated: this moves the shell — page padding, the gaps between
// steps, card padding. It does NOT move the spacing between fields, which is
// fixed Tailwind inside `FormRunner`, shared with public single forms and
// deliberately left alone. Compact is tighter, not tiny.
// ─────────────────────────────────────────────────────────────────────────────

export interface DensityTokens {
  /** Outer page padding. */
  page: string;
  /** Vertical rhythm between step sections and the submit bar. */
  stack: string;
  /** Internal spacing of a Card. Applied on the Card itself. */
  card: string;
  /** Padding around one entry's fields. */
  entry: string;
  /** Space below the masthead. */
  masthead: string;
}

export const DENSITY: Record<AppDensity, DensityTokens> = {
  compact: {
    page: 'px-4 py-5 sm:px-6 sm:py-8',
    stack: 'space-y-4',
    card: '[--card-spacing:--spacing(3)]',
    entry: 'p-3 sm:p-4',
    masthead: 'mb-4',
  },
  comfortable: {
    page: 'px-4 py-8 sm:px-6 sm:py-12',
    stack: 'space-y-6',
    card: '[--card-spacing:--spacing(4)]',
    entry: 'p-4 sm:p-5',
    masthead: 'mb-6',
  },
  spacious: {
    page: 'px-4 py-12 sm:px-8 sm:py-16',
    stack: 'space-y-9',
    card: '[--card-spacing:--spacing(6)]',
    entry: 'p-6 sm:p-8',
    masthead: 'mb-10',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Texture
//
// Painted with gradients against the theme's own derived tokens, so a texture
// costs no image request and cannot clash with the palette — `--border` is
// already a mix of the text colour over the card, and `--primary` is the
// author's brand colour.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Page-background decoration for a texture.
 *
 * Suppressed for `glass` cards, and that is not a detail. Glass is translucent
 * with a heavy backdrop blur; over a dot grid or a colour mesh the pattern
 * shows through the card and the text sitting on it becomes genuinely hard to
 * read. Suppressing at RENDER rather than dropping the stored value means the
 * choice survives a switch back to solid cards, and the settings panel can say
 * why it currently has no effect instead of silently resetting itself.
 */
export function textureStyle(
  texture: AppTexture,
  cardVariant: FormTheme['cardVariant'] | undefined,
): CSSProperties {
  if (texture === 'none' || cardVariant === 'glass') return {};

  switch (texture) {
    case 'dots':
      return {
        backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      };

    case 'grid':
      return {
        backgroundImage:
          'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
        backgroundSize: '28px 28px',
      };

    case 'mesh':
      return {
        backgroundImage: [
          'radial-gradient(48rem 24rem at 8% -8%, color-mix(in srgb, var(--primary) 20%, transparent), transparent)',
          'radial-gradient(40rem 20rem at 105% 4%, color-mix(in srgb, var(--primary) 13%, transparent), transparent)',
        ].join(', '),
        backgroundRepeat: 'no-repeat',
        // Anchored to the viewport so the wash stays at the top of the screen
        // rather than scrolling away and leaving a hard edge mid-page.
        backgroundAttachment: 'fixed',
      };

    case 'accentBar':
      return {
        backgroundImage: 'linear-gradient(var(--primary), var(--primary))',
        backgroundSize: '100% 0.375rem',
        backgroundRepeat: 'no-repeat',
      };

    default:
      return {};
  }
}

/** Human labels, shared by the settings panel so it cannot drift from the code. */
export const APPEARANCE_LABELS = {
  shell: {
    document: 'Stacked page',
    wizard: 'One step at a time',
    console: 'Step rail',
    mobile: 'Mobile app',
  } satisfies Record<AppShell, string>,
  masthead: {
    plain: 'Plain card',
    gradient: 'Colour wash',
    hero: 'Cover image',
    bar: 'Slim bar',
  } satisfies Record<AppMastheadStyle, string>,
  stepStyle: {
    bordered: 'Underlined heading',
    timeline: 'Numbered timeline',
    accordion: 'Collapsible',
    plain: 'Plain heading',
  } satisfies Record<AppStepStyle, string>,
  density: {
    compact: 'Compact',
    comfortable: 'Comfortable',
    spacious: 'Spacious',
  } satisfies Record<AppDensity, string>,
  texture: {
    none: 'None',
    dots: 'Dots',
    grid: 'Grid',
    mesh: 'Colour mesh',
    accentBar: 'Top accent bar',
  } satisfies Record<AppTexture, string>,
  width: {
    narrow: 'Narrow',
    medium: 'Medium',
    wide: 'Wide',
    full: 'Full width',
  } satisfies Record<AppWidth, string>,
} as const;
