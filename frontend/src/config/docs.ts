/**
 * The documentation table of contents.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ONE source of truth, used by the sidebar, the mobile picker, the previous/next
 * footer links, and the search index. A docs site whose sidebar and whose
 * "next page" button disagree is how readers end up in loops, and keeping four
 * copies of an ordering in step by hand is not a thing anyone succeeds at.
 *
 * Order here IS reading order. `flatDocs()` walks it to produce the sequence the
 * footer pages through, so moving an entry moves it everywhere at once.
 */

export interface DocPageRef {
  title: string;
  href: string;
  /** One line, shown under the title on section index pages and in search. */
  summary: string;
}

export interface DocSection {
  title: string;
  /** Why this group exists, shown on the docs home page. */
  summary: string;
  pages: DocPageRef[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    title: 'Getting started',
    summary: 'What the platform is, and how to get a working form in front of people.',
    pages: [
      {
        title: 'Overview',
        href: '/docs',
        summary: 'What Formora does, and which part of it you need.',
      },
      {
        title: 'Quickstart',
        href: '/docs/quickstart',
        summary: 'Build, publish and share a form, then read the first response.',
      },
      {
        title: 'Core concepts',
        href: '/docs/concepts',
        summary:
          'Organizations, forms, versions, responses, records, apps and option lists — and how they relate.',
      },
    ],
  },
  {
    title: 'Building forms',
    summary: 'Everything in the form builder, from a single field to a rule engine.',
    pages: [
      {
        title: 'The builder',
        href: '/docs/forms/builder',
        summary: 'The canvas, the outline, the panels, and how autosave works.',
      },
      {
        title: 'Field types',
        href: '/docs/forms/fields',
        summary: 'Every question type, what it stores, and when to reach for it.',
      },
      {
        title: 'Pages and layout',
        href: '/docs/forms/layout',
        summary: 'Multi-page forms, and the stacked, conversational and grid layouts.',
      },
      {
        title: 'Build a form, step by step',
        href: '/docs/forms/examples',
        summary: 'Three complete forms built field by field — an intake form, a monitoring visit, and a scored assessment.',
      },
      {
        title: 'Conditional logic',
        href: '/docs/forms/logic',
        summary: 'Show and hide questions based on what someone has already answered.',
      },
      {
        title: 'Rules and calculations',
        href: '/docs/forms/rules',
        summary: 'Calculated fields, conditional requiredness, and validation that spans questions.',
      },
      {
        title: 'Operators reference',
        href: '/docs/forms/rules/operators',
        summary: 'Every operator the rules engine supports, grouped, each with a worked example.',
      },
      {
        title: 'Worked rule examples',
        href: '/docs/forms/rules/examples',
        summary: 'Complete rules explained line by line, and the templates the rule editor starts from.',
      },
      {
        title: 'Form settings',
        href: '/docs/forms/settings',
        summary: 'The public link, access control, response caps, expiry and notifications.',
      },
      {
        title: 'Theme and branding',
        href: '/docs/forms/theme',
        summary: 'Colours, typography, logo and cover image.',
      },
    ],
  },
  {
    title: 'Option lists',
    summary: 'Reference data your dropdowns draw from, managed in one place.',
    pages: [
      {
        title: 'Option lists',
        href: '/docs/option-lists',
        summary: 'Create a list, upload a CSV, and bind a question to it.',
      },
      {
        title: 'Cascading and lookups',
        href: '/docs/option-lists/cascading',
        summary: 'Dependent dropdowns, and auto-filling a field from the option someone picked.',
      },
    ],
  },
  {
    title: 'Publishing and responses',
    summary: 'Getting a form in front of people, and working with what comes back.',
    pages: [
      {
        title: 'Publishing and sharing',
        href: '/docs/publishing',
        summary: 'Versions, the public link, and what changes when you republish.',
      },
      {
        title: 'Responses',
        href: '/docs/responses',
        summary: 'Reading, filtering, exporting and deleting responses.',
      },
      {
        title: 'Analytics',
        href: '/docs/analytics',
        summary: 'Views, starts, completion rate and drop-off.',
      },
      {
        title: 'Integrations',
        href: '/docs/integrations',
        summary: 'Webhooks, their payload, signing and retries.',
      },
    ],
  },
  {
    title: 'Data apps',
    summary:
      'A guided, multi-form surface for collecting data about the same subject over time.',
    pages: [
      {
        title: 'What a data app is',
        href: '/docs/apps',
        summary: 'When to build an app instead of a form, and what it gives you.',
      },
      {
        title: 'Record types',
        href: '/docs/apps/record-types',
        summary: 'Defining the subject an app collects data about, and its identity.',
      },
      {
        title: 'Steps',
        href: '/docs/apps/steps',
        summary: 'Ordering forms, repeating them, and making them conditional.',
      },
      {
        title: 'Build an app, step by step',
        href: '/docs/apps/examples',
        summary: 'A complete worked example: a record type, a registration step, and a repeatable visit step that reads back an earlier answer.',
      },
      {
        title: 'Records and timeline',
        href: '/docs/apps/records',
        summary: 'Reading everything collected about one subject in one place.',
      },
      {
        title: 'App appearance',
        href: '/docs/apps/appearance',
        summary:
          'Paging steps, page width, headers, spacing, and why field widths need the right layout.',
      },
    ],
  },
  {
    title: 'Administration',
    summary: 'People, permissions, and the platform itself.',
    pages: [
      {
        title: 'Team and roles',
        href: '/docs/team',
        summary: 'Inviting people, and what Admin, Editor and Viewer can each do.',
      },
      {
        title: 'Organization settings',
        href: '/docs/organization',
        summary: 'Name, branding, limits, the audit log, and switching workspaces.',
      },
      {
        title: 'Platform administration',
        href: '/docs/platform',
        summary: 'Super-admin tools: organizations, users, features, health and the global dictionary.',
      },
    ],
  },
];

/** Reading order, flattened. Drives the previous/next footer. */
export function flatDocs(): DocPageRef[] {
  return DOC_SECTIONS.flatMap((section) => section.pages);
}

/** The page before and after `href` in reading order. */
export function docNeighbours(href: string): {
  previous: DocPageRef | null;
  next: DocPageRef | null;
} {
  const pages = flatDocs();
  const index = pages.findIndex((page) => page.href === href);
  if (index === -1) return { previous: null, next: null };
  return {
    previous: pages[index - 1] ?? null,
    next: pages[index + 1] ?? null,
  };
}

/** The section a page belongs to, for the breadcrumb. */
export function docSectionOf(href: string): DocSection | null {
  return DOC_SECTIONS.find((section) => section.pages.some((page) => page.href === href)) ?? null;
}
