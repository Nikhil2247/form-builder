'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { DOC_SECTIONS, flatDocs } from '@/config/docs';

/**
 * Documentation navigation.
 *
 * One component drives both presentations: a sticky rail on desktop and a
 * slide-over on small screens. They share the same tree and the same active
 * calculation, so a page cannot be highlighted in one and not the other.
 */
export function DocsSidebar() {
  const pathname = usePathname();
  const [query, setQuery] = React.useState('');

  /**
   * Which page the mobile panel was opened from, or `null` for closed.
   *
   * Any navigation closes it — otherwise tapping a link swaps the page
   * underneath while the overlay stays up, which reads as a link that did
   * nothing. That is DERIVED from the pathname moving on rather than
   * synchronised by an effect, so the panel is already closed on the render
   * that shows the new page instead of one frame later.
   */
  const [openedAt, setOpenedAt] = React.useState<string | null>(null);
  const isOpen = openedAt === pathname;

  const setOpen = (open: boolean) => setOpenedAt(open ? pathname : null);

  const term = query.trim().toLowerCase();
  const matches = term
    ? flatDocs().filter(
        (page) =>
          page.title.toLowerCase().includes(term) || page.summary.toLowerCase().includes(term),
      )
    : null;

  const tree = (
    <nav aria-label="Documentation" className="flex flex-col gap-6">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the docs…"
          aria-label="Search the documentation"
          className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm
                     placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {matches ? (
        matches.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">
            Nothing matches “{query}”. Try a feature name — “cascading”, “webhook”, “roles”.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {matches.map((page) => (
              <li key={page.href}>
                <Link
                  href={page.href}
                  className="block rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <span className="block font-medium text-foreground">{page.title}</span>
                  <span className="block truncate text-xs">{page.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : (
        DOC_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-2.5 text-xs font-semibold uppercase tracking-wider text-foreground">
              {section.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.pages.map((page) => {
                // Exact match only. `startsWith` would light up "Option lists"
                // while the reader is on "Cascading and lookups", which sits
                // beneath it in the URL but is a sibling in the tree.
                const isActive = pathname === page.href;
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'block rounded-md px-2.5 py-1.5 text-sm transition-colors',
                        isActive
                          ? 'bg-primary/10 font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      {page.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))
      )}
    </nav>
  );

  return (
    <>
      {/* ── Mobile trigger ──────────────────────────────────────────────── */}
      <div className="sticky top-16 z-30 -mx-4 mb-6 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-sm font-medium text-foreground"
          aria-expanded={isOpen}
        >
          <Menu className="size-4" strokeWidth={1.5} />
          Documentation menu
        </button>
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close the documentation menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-[19rem] max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-background p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Documentation</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
            </div>
            {tree}
          </div>
        </div>
      )}

      {/* ── Desktop rail ────────────────────────────────────────────────── */}
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto lg:pr-2">
        {tree}
      </aside>
    </>
  );
}
