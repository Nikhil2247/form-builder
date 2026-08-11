import React from 'react';
import type { Metadata } from 'next';

import { DocsSidebar } from '@/components/docs/DocsSidebar';
import { DocsToc } from '@/components/docs/DocsToc';

export const metadata: Metadata = {
  title: {
    default: 'Documentation',
    template: '%s · Formora docs',
  },
  description:
    'How to use Formora: building forms, conditional logic and rules, option lists, data apps, responses, and administration.',
};

/**
 * Nested inside the marketing layout, so the docs inherit the public header,
 * footer and theme toggle rather than reimplementing them. What is added here
 * is only what a documentation site needs on top of a marketing page.
 *
 * Three surfaces, not one flat white page: a tinted page background, the nav
 * rail sitting directly on it, and the article as a raised card. In light
 * mode `--card` and `--background` used to be within a few percent of each
 * other with nothing but a 1px border between the nav and the content, which
 * read as one undifferentiated white field. This gives the eye an actual
 * boundary to find.
 *
 * The third column — the on-page TOC — exists because a two-column layout
 * left a fixed 16rem rail and then let the article's own `max-w-3xl` stop
 * short of the rest of a wide viewport, so the right half of the page sat
 * empty. From `xl` up that space now does something.
 */
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/40">
      <div className="mx-auto max-w-[100rem] px-4 sm:px-6 lg:px-8">
        <div
          className="grid items-start gap-8 py-8 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10
                     lg:py-12 xl:grid-cols-[17rem_minmax(0,1fr)_15rem]"
        >
          <DocsSidebar />
          <main
            id="docs-content"
            className="min-w-0 rounded-2xl border border-border bg-card px-5 py-8 shadow-card
                       sm:px-8 sm:py-10 lg:px-10"
          >
            {children}
          </main>
          <DocsToc />
        </div>
      </div>
    </div>
  );
}
