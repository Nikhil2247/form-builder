'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface TocItem {
  id: string;
  text: string;
}

/**
 * "On this page" rail, generated from whatever `h2[id]`s the current doc
 * article rendered — not a hand-maintained list, so it cannot drift from the
 * page's actual `DocSectionBlock`s.
 *
 * Only shown from `xl` up. Below that the layout is two columns and this
 * space is where the article itself gets the width instead.
 */
export function DocsToc() {
  const pathname = usePathname();
  const [items, setItems] = React.useState<TocItem[]>([]);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  React.useEffect(() => {
    // DocSectionBlock puts the anchor id on the <section>, not the <h2> it
    // wraps — the heading itself carries no id to select on.
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('#docs-content section[id] > h2'),
    );
    const next = sections
      .map((heading) => {
        const id = heading.parentElement?.id;
        if (!id) return null;
        // DocSectionBlock appends a hidden "#" permalink glyph inside the
        // heading; it is part of textContent even while invisible.
        const text = (heading.textContent ?? '').replace(/#\s*$/, '').trim();
        return { id, text };
      })
      .filter((item): item is TocItem => item !== null);
    setItems(next);
    setActiveId(next[0]?.id ?? null);
  }, [pathname]);

  React.useEffect(() => {
    if (items.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      // Counts a heading as "current" once it has cleared the sticky header,
      // and keeps counting it until it is most of the way off the top of the
      // viewport — matches how someone reading down the page would describe
      // "which section am I in".
      { rootMargin: '-100px 0px -70% 0px', threshold: 0 },
    );

    items.forEach((item) => {
      const el = document.getElementById(item.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [items]);

  if (items.length < 2) return null;

  return (
    <aside className="hidden xl:sticky xl:top-24 xl:block xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">
      <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        On this page
      </p>
      <ul className="flex flex-col gap-0.5 border-l border-border">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={activeId === item.id ? 'location' : undefined}
              className={cn(
                '-ml-px block truncate border-l-2 py-1 pl-3 pr-2 text-sm transition-colors',
                activeId === item.id
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border-strong hover:text-foreground',
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
