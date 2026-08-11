import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  HeartPulse,
  MapPinned,
  MessageSquareQuote,
  UserPlus,
  Wrench,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  CallToAction,
  Marked,
  PageHero,
  Reveal,
  RevealGroup,
  RevealItem,
  Section,
  SectionHeading,
} from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Templates',
  description:
    'Starting points for the forms people actually build here — monitoring visits, intake, assessments, feedback and registration — and which features each one uses.',
};

/**
 * Templates.
 *
 * ── What changed ──────────────────────────────────────────────────────────
 * The previous page listed eight templates with usage counts beside them —
 * "24.3k", "15.1k", "12.4k" — none of which came from anywhere. Invented
 * adoption figures are the kind of detail a visitor spot-checks, and there is
 * no counter behind them to make true later.
 *
 * What is described here is what a template of each kind CONTAINS, and which
 * documented feature it leans on. That is more useful than a popularity number
 * anyway: someone choosing a starting point wants to know whether it already
 * has the repeating section they need.
 *
 * The gallery itself lives in the product — templates are picked when creating
 * a form, where they can be previewed against your own workspace.
 */

interface Template {
  icon: typeof ClipboardList;
  name: string;
  category: string;
  body: string;
  uses: string[];
}

const TEMPLATES: Template[] = [
  {
    icon: MapPinned,
    name: 'Field monitoring visit',
    category: 'Monitoring and evaluation',
    body: 'A respondent block, a section repeated once per site visited, and a summary. Location fields cascade from district down to the individual site.',
    uses: ['Repeating sections', 'Cascading option lists', 'Data app steps'],
  },
  {
    icon: UserPlus,
    name: 'Programme intake',
    category: 'Intake',
    body: 'Applicant details, household composition, and eligibility questions that appear only for the applicants they apply to — with the eligibility outcome calculated as the form is filled.',
    uses: ['Conditional logic', 'Calculated fields', 'Conditional requiredness'],
  },
  {
    icon: ClipboardCheck,
    name: 'Site assessment',
    category: 'Assessment',
    body: 'A scored checklist across several sections, with cross-field checks that catch a contradiction at the point it is entered rather than at analysis time.',
    uses: ['Scoring', 'Cross-question validation', 'Multi-page layout'],
  },
  {
    icon: GraduationCap,
    name: 'Training feedback',
    category: 'Feedback',
    body: 'A short form built around rating scales and one open question, laid out two columns wide so it fits on a single screen.',
    uses: ['Star rating', 'NPS', 'Grid layout'],
  },
  {
    icon: ClipboardList,
    name: 'Event registration',
    category: 'Registration',
    body: 'Contact details, session choices drawn from a managed list, and dietary or access requirements. Closes itself when it reaches capacity.',
    uses: ['Option lists', 'Response cap', 'Expiry date'],
  },
  {
    icon: HeartPulse,
    name: 'Beneficiary record',
    category: 'Data app',
    body: 'A record type for the person or household, with follow-up forms filed against the same subject each time they are seen — so the timeline builds up over months.',
    uses: ['Record types', 'Steps', 'Records and timeline'],
  },
  {
    icon: MessageSquareQuote,
    name: 'Complaint and feedback intake',
    category: 'Feedback',
    body: 'An anonymous route and an identified one, with follow-up questions that appear only when the person wants a response, and files attachable as evidence.',
    uses: ['Conditional logic', 'File upload', 'Webhooks'],
  },
  {
    icon: Wrench,
    name: 'Asset and inventory check',
    category: 'Operations',
    body: 'One repeating row per item, quantities validated against a range, and a running total that fills in as rows are added.',
    uses: ['Repeating sections', 'Validation bounds', 'Calculated fields'],
  },
];

export default function TemplatesPage() {
  return (
    <>
      <PageHero
        eyebrow="Templates"
        title={
          <>
            Start from something <Marked>already shaped</Marked>
          </>
        }
        lead="Each of these is a form or app with its questions, logic and settings already in place. Open one, change what does not fit, and publish — rather than starting from an empty canvas and rediscovering which features you needed."
        actions={
          <>
            <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
              Browse them in the app
            </Link>
            <Link href="/docs/quickstart" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Or build one from scratch
            </Link>
          </>
        }
      />

      <Section pattern>
        <SectionHeading
          eyebrow="Starting points"
          title="What each one already contains"
          lead="Listed by what is inside it, so you can tell at a glance whether it has the repeating section or the cascade you were going to have to add anyway."
        />

        <RevealGroup className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((template) => {
            const Icon = template.icon;
            return (
              <RevealItem
                key={template.name}
                className={cn(
                  'flex h-full flex-col rounded-2xl border border-border bg-card p-6 shadow-card',
                  'transition-[transform,box-shadow,border-color] duration-200',
                  'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lg',
                  'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                )}
              >
                <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                </div>

                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {template.category}
                </p>
                <h3 className="mb-2 mt-1 font-semibold text-foreground">{template.name}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{template.body}</p>

                <ul className="mt-5 flex flex-wrap gap-1.5 border-t border-border pt-4">
                  {template.uses.map((use) => (
                    <li
                      key={use}
                      className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground"
                    >
                      {use}
                    </li>
                  ))}
                </ul>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </Section>

      <Section tone="muted">
        <SectionHeading
          eyebrow="How templates work"
          title="A copy, not a link"
          lead="Starting from a template copies its questions, logic, rules and settings into your workspace. It is yours from that moment — edit it however you like, and nothing changes underneath you later."
        />

        <Reveal className="flex flex-wrap gap-3">
          <Link href="/docs/forms/builder" className={buttonVariants({ variant: 'outline' })}>
            How the builder works
          </Link>
          <Link href="/docs/publishing" className={buttonVariants({ variant: 'outline' })}>
            Publishing and versions
          </Link>
          <Link href="/docs/apps" className={buttonVariants({ variant: 'outline' })}>
            When to use a data app instead
          </Link>
        </Reveal>
      </Section>

      <CallToAction
        title="Pick one and publish it today"
        lead="Create a workspace, start from whichever of these is closest, and have a working link before the end of the afternoon."
      />
    </>
  );
}
