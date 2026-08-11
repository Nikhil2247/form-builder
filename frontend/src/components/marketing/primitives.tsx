import React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  CountUp,
  HandUnderline,
  Reveal,
  RevealGroup,
  RevealItem,
} from '@/components/marketing/motion';

// Re-exported so a page has one import for the whole marketing kit rather than
// having to know which pieces happen to be client components.
export { CountUp, HandUnderline, Reveal, RevealGroup, RevealItem };

/**
 * The marketing site's building blocks.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every public page was previously a bespoke arrangement of `py-24`,
 * `max-w-6xl`, `text-4xl md:text-6xl` and a hand-rolled card, repeated with
 * small variations per file. The variations were not decisions — they were
 * drift — and they are why the pages read as a set of templates rather than as
 * one product.
 *
 * These are deliberately server components. The pages that used them were all
 * marked `'use client'` for no reason beyond having been written that way,
 * which shipped framer-motion and the whole marketing tree to the browser and
 * — more importantly — made it impossible to export `metadata`, so none of the
 * public pages had a title or description for search engines or link previews.
 *
 * ── The rhythm ────────────────────────────────────────────────────────────
 * Sections alternate `plain` and `muted` down a page so the eye gets a
 * boundary without a rule being drawn, and every section shares one container
 * width. Anything wanting to be wider is a deliberate exception, not a
 * different number picked in a different file.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Backdrops
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The engineering-paper grid behind a section.
 *
 * Drawn from `--border` rather than a hardcoded `rgba(0,0,0,0.03)`, which is
 * what the old landing page used: black-on-black is invisible in dark mode, so
 * the pattern simply vanished for half the audience. Using the token means it
 * follows the theme like everything else does.
 *
 * The radial mask is what keeps it a texture instead of graph paper — the grid
 * is present where it frames a heading and gone by the time it would sit
 * behind body text.
 */
export function GridPattern({
  className,
  fade = 'top',
}: {
  className?: string;
  /** Where the pattern is strongest before the mask takes it away. */
  fade?: 'top' | 'center' | 'right';
}) {
  const mask =
    fade === 'top'
      ? '[mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,#000_55%,transparent_100%)]'
      : fade === 'right'
        ? '[mask-image:radial-gradient(ellipse_60%_80%_at_100%_50%,#000_35%,transparent_100%)]'
        : '[mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_35%,transparent_100%)]';

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 opacity-70',
        'bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]',
        'bg-[size:3.5rem_3.5rem]',
        mask,
        className,
      )}
    />
  );
}

/** Soft brand-coloured light behind a hero. Sits under the grid, not over it. */
export function Glow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute left-1/2 top-0 h-[26rem] w-[52rem] -translate-x-1/2',
        '-translate-y-1/3 rounded-full bg-primary/10 blur-3xl',
        className,
      )}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────────────────

export function Section({
  children,
  tone = 'plain',
  className,
  id,
  /** Draw the grid texture behind this band. */
  pattern = false,
}: {
  children: React.ReactNode;
  /** `muted` gives the band its own surface; alternate it down the page. */
  tone?: 'plain' | 'muted';
  className?: string;
  id?: string;
  pattern?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        // `isolate` gives the pattern a stacking context to sit inside, so it
        // cannot escape behind the page background.
        'relative isolate overflow-hidden border-b border-border/60 py-20 last:border-b-0 sm:py-24',
        tone === 'muted' && 'bg-muted/40',
        className,
      )}
    >
      {pattern && <GridPattern fade="center" />}
      <div className="container relative mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}

/**
 * A grid of cards that arrive one after another as it scrolls in.
 *
 * Each child is wrapped in a `RevealItem` here rather than at the call site,
 * because the wrapper has to be the direct grid child for the layout to
 * survive — and a page should not have to know that.
 */
export function CardGrid({
  children,
  className = 'grid gap-6 sm:grid-cols-2 lg:grid-cols-3',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <RevealGroup className={className}>
      {React.Children.map(children, (child) =>
        child == null ? child : <RevealItem>{child}</RevealItem>,
      )}
    </RevealGroup>
  );
}

/** Small uppercase kicker above a heading. Names the area being discussed. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  align = 'left',
}: {
  eyebrow?: string;
  title: string;
  lead?: React.ReactNode;
  align?: 'left' | 'center';
}) {
  return (
    <Reveal className={cn('mb-12 max-w-3xl', align === 'center' && 'mx-auto text-center')}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      {lead && <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{lead}</p>}
    </Reveal>
  );
}

/**
 * The emphasised word in a heading, with the hand-drawn underline beneath it.
 *
 * `inline-block` is load-bearing: the underline is absolutely positioned
 * against this element, so it needs to be the containing block and needs a
 * height. The word also gets a little bottom padding so a descender in the
 * word does not collide with the stroke.
 */
export function Marked({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block pb-1 text-primary">
      {children}
      <HandUnderline className="text-primary/45" />
    </span>
  );
}

/**
 * The band at the top of a page.
 *
 * One `h1` per page, one measure, one pair of calls to action — rather than
 * each page inventing its own hero scale and ending up a different size from
 * its neighbours.
 */
export function PageHero({
  eyebrow,
  title,
  lead,
  actions,
  children,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden border-b border-border/60 bg-muted/40">
      <Glow />
      <GridPattern fade="top" />

      <div className="container relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
        {/* Not scroll-triggered — this is above the fold, so it plays on load
            rather than waiting for a scroll that may never come. */}
        <Reveal className="max-w-3xl" distance={16}>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1 className="font-display text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          {lead && (
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">{lead}</p>
          )}
          {actions && <div className="mt-10 flex flex-wrap items-center gap-3">{actions}</div>}
        </Reveal>
        {children}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Content
// ─────────────────────────────────────────────────────────────────────────────

export function FeatureCard({
  icon: Icon,
  title,
  children,
  href,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
  /** Present = the card links somewhere, usually the matching docs page. */
  href?: string;
}) {
  const body = (
    <>
      <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="mb-2 font-semibold text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
      {href && (
        <span className="mt-4 inline-block text-sm font-medium text-primary">Read the docs →</span>
      )}
    </>
  );

  // The lift is small on purpose. A card that jumps on hover is a card you
  // notice instead of reading; 2px and a slightly deeper shadow is enough to
  // say "this responds to you" without becoming the subject.
  const className = cn(
    'h-full rounded-2xl border border-border bg-card p-6 shadow-card',
    'transition-[transform,box-shadow,border-color] duration-200 motion-reduce:transition-none',
    'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg motion-reduce:hover:translate-y-0',
  );

  return href ? (
    <Link href={href} className={cn(className, 'block')}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * A capability described at length, with its concrete details listed out.
 *
 * The alternating `reverse` is what stops a page of these from reading as a
 * wall — and the detail list is the point of the component: a marketing claim
 * that cannot name three specific things underneath it is not worth the space.
 */
export function FeatureRow({
  eyebrow,
  title,
  lead,
  points,
  href,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  lead: React.ReactNode;
  points: Array<{ term: string; detail: string }>;
  href?: string;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-start gap-10 py-14 first:pt-0 last:pb-0 lg:grid-cols-2 lg:gap-16">
      <Reveal className={cn(reverse && 'lg:order-2')}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h3>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">{lead}</p>
        {href && (
          <Link
            href={href}
            className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
          >
            Read the docs →
          </Link>
        )}
      </Reveal>

      <RevealGroup as="dl" className={cn('space-y-5', reverse && 'lg:order-1')}>
        {points.map((point) => (
          <RevealItem
            key={point.term}
            className="rounded-xl border border-border bg-card p-5 shadow-card"
          >
            <dt className="text-sm font-semibold text-foreground">{point.term}</dt>
            <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {point.detail}
            </dd>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}

/** Definition-style list for facts that want scanning, not prose. */
export function FactGrid({
  items,
}: {
  items: Array<{ term: string; detail: React.ReactNode }>;
}) {
  return (
    <RevealGroup as="dl" className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <RevealItem key={item.term} className="border-t border-border pt-4">
          <dt className="text-sm font-semibold text-foreground">{item.term}</dt>
          <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.detail}</dd>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

export function Faq({ items }: { items: Array<{ question: string; answer: React.ReactNode }> }) {
  return (
    <Reveal className="divide-y divide-border border-y border-border">
      {items.map((item) => (
        // <details> rather than a JS accordion: it opens without hydration,
        // is keyboard operable for free, and is findable by the browser's own
        // in-page search even while collapsed.
        <details key={item.question} className="group py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-foreground marker:content-none">
            {item.question}
            <span
              aria-hidden
              className="shrink-0 text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <div className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {item.answer}
          </div>
        </details>
      ))}
    </Reveal>
  );
}

/** Closing call to action. Same one everywhere, so it reads as the product's. */
export function CallToAction({
  title = 'Build your first form',
  lead = 'Create a workspace, build a form, and share a link. Nothing to install, and no card needed to start.',
}: {
  title?: string;
  lead?: string;
}) {
  return (
    <Section tone="muted" pattern>
      <Reveal className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          {title}
        </h2>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{lead}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
            Get started
          </Link>
          <Link href="/docs" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Read the documentation
          </Link>
        </div>
      </Reveal>
    </Section>
  );
}
