import React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Info,
  Lightbulb,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { docNeighbours, docSectionOf, type DocPageRef } from '@/config/docs';

/**
 * The building blocks every documentation page is made of.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Components rather than MDX. Three reasons: the pages are TSX already so they
 * type-check against the real `DOC_SECTIONS` (a link to a page that does not
 * exist fails the build rather than 404-ing for a reader), no build-plugin
 * configuration is added to the Next app, and a doc page can render live
 * product components — the field-type table below is the same data the builder
 * uses, not a copy of it that goes stale.
 */

// ── Page frame ───────────────────────────────────────────────────────────────

export function DocPage({
  href,
  title,
  intro,
  children,
}: {
  /** Must match this page's entry in DOC_SECTIONS — it drives the footer. */
  href: string;
  title: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  const section = docSectionOf(href);

  return (
    <article className="min-w-0 max-w-3xl pb-16">
      {section && (
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
          {section.title}
        </p>
      )}

      <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{title}</h1>
      <div className="mt-4 text-base leading-relaxed text-muted-foreground">{intro}</div>

      <div className="mt-10 flex flex-col gap-10">{children}</div>

      <DocFooterNav href={href} />
    </article>
  );
}

/**
 * A titled section with a stable anchor.
 *
 * The `id` comes from the title rather than being passed separately, so a
 * heading and the link people share to it cannot drift apart.
 */
export function DocSectionBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const id = slugify(title);

  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="group flex items-baseline gap-2 text-xl font-semibold tracking-tight text-foreground">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
        <span
          aria-hidden
          className="text-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        >
          #
        </span>
      </h2>
      <div className="mt-3 flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </section>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="leading-relaxed">{children}</p>;
}

/** Emphasis for a term being defined. */
export function Term({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>;
}

/** A UI label the reader will look for on screen. */
export function UI({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.8125rem] font-medium text-foreground">
      {children}
    </span>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground">
      {children}
    </code>
  );
}

export function DocList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2 pl-1">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5">
          <span aria-hidden className="mt-[0.4375rem] size-1.5 shrink-0 rounded-full bg-border-strong" />
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Numbered procedure. Use where order genuinely matters. */
export function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold tabular-nums text-primary">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Callouts ─────────────────────────────────────────────────────────────────

const CALLOUT_STYLES: Record<
  'note' | 'tip' | 'warning',
  { icon: LucideIcon; wrapper: string; iconClass: string; label: string }
> = {
  note: {
    icon: Info,
    wrapper: 'border-border bg-muted/50',
    iconClass: 'text-muted-foreground',
    label: 'Note',
  },
  tip: {
    icon: Lightbulb,
    wrapper: 'border-primary/30 bg-primary/5',
    iconClass: 'text-primary',
    label: 'Tip',
  },
  warning: {
    icon: AlertTriangle,
    wrapper: 'border-amber-500/30 bg-amber-500/5',
    iconClass: 'text-amber-600 dark:text-amber-500',
    label: 'Careful',
  },
};

export function Callout({
  type = 'note',
  title,
  children,
}: {
  type?: 'note' | 'tip' | 'warning';
  title?: string;
  children: React.ReactNode;
}) {
  const style = CALLOUT_STYLES[type];
  const Icon = style.icon;

  return (
    <aside className={cn('flex gap-3 rounded-xl border px-4 py-3.5', style.wrapper)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', style.iconClass)} strokeWidth={1.5} />
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        <p className="font-semibold text-foreground">{title ?? style.label}</p>
        <div className="mt-1 text-muted-foreground">{children}</div>
      </div>
    </aside>
  );
}

// ── Tables ───────────────────────────────────────────────────────────────────

/**
 * A reference table.
 *
 * Scrolls inside its own container rather than widening the page — a settings
 * table with four columns must not make the whole article scroll sideways on a
 * phone.
 */
export function DocTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="align-top">
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    'px-4 py-3 leading-relaxed',
                    cellIndex === 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A short do/don't pair — clearer than prose for a judgement call. */
export function Compare({
  doTitle = 'Do this',
  dontTitle = 'Not this',
  doItems,
  dontItems,
}: {
  doTitle?: string;
  dontTitle?: string;
  doItems: React.ReactNode[];
  dontItems: React.ReactNode[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-500" strokeWidth={2} />
          {doTitle}
        </p>
        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {doItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <p className="mb-2 text-sm font-semibold text-foreground">{dontTitle}</p>
        <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {dontItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Cross links ──────────────────────────────────────────────────────────────

export function DocLink({ page }: { page: DocPageRef }) {
  return (
    <Link
      href={page.href}
      className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-border-strong hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{page.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{page.summary}</p>
      </div>
      <ArrowRight
        className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.5}
      />
    </Link>
  );
}

export function DocLinkGrid({ pages }: { pages: DocPageRef[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {pages.map((page) => (
        <DocLink key={page.href} page={page} />
      ))}
    </div>
  );
}

/**
 * Previous/next, driven by DOC_SECTIONS order.
 *
 * Present on every page so the docs can be read straight through, which is how
 * someone new to the product actually gets oriented.
 */
function DocFooterNav({ href }: { href: string }) {
  const { previous, next } = docNeighbours(href);
  if (!previous && !next) return null;

  return (
    <nav
      aria-label="Documentation pages"
      className="mt-14 grid gap-3 border-t border-border pt-6 sm:grid-cols-2"
    >
      {previous ? (
        <Link
          href={previous.href}
          className="rounded-xl border border-border p-4 transition-colors hover:border-border-strong hover:bg-muted/50"
        >
          <span className="text-xs text-muted-foreground">Previous</span>
          <span className="mt-0.5 block text-sm font-semibold text-foreground">
            {previous.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link
          href={next.href}
          className="rounded-xl border border-border p-4 text-right transition-colors hover:border-border-strong hover:bg-muted/50 sm:col-start-2"
        >
          <span className="text-xs text-muted-foreground">Next</span>
          <span className="mt-0.5 block text-sm font-semibold text-foreground">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
