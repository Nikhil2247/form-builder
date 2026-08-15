import type { Metadata } from 'next';
import Link from 'next/link';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  CallToAction,
  Faq,
  Marked,
  PageHero,
  RevealGroup,
  RevealItem,
  Section,
  SectionHeading,
} from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Every plan includes every feature. Plans differ by how many forms, responses, team members and files a workspace can hold.',
};

/**
 * Pricing.
 *
 * ── What changed and why ──────────────────────────────────────────────────
 * The previous version sold the plans on features that do not exist — "HIPAA &
 * SOC2 Compliance", "SSO (SAML, OIDC)", "Dedicated Success Manager", "Custom
 * SLAs" — and implied the cheaper plans were missing capabilities they are not
 * missing. There is no feature gating by plan anywhere in the product; quotas
 * are per organization (maxForms, maxSubmissionsMonth, maxMembers,
 * storageQuotaBytes) and those are the only things that actually differ.
 *
 * So the page now says exactly that: same product, different ceilings. It is a
 * simpler story and it has the advantage of being true, which matters more on
 * the page where someone decides to pay.
 *
 * The monthly figures are carried over from the previous page unchanged — they
 * are a commercial decision, not one to make in a rewrite.
 */

interface Plan {
  name: string;
  price: string;
  cadence?: string;
  description: string;
  cta: { label: string; href: string };
  featured?: boolean;
  limits: Array<{ label: string; value: string }>;
}

const PLANS: Plan[] = [
  {
    name: 'Starter',
    price: 'Free',
    description: 'Enough to run something real, not a demo with the useful parts removed.',
    cta: { label: 'Create a workspace', href: '/signup' },
    limits: [
      { label: 'Forms', value: '3' },
      { label: 'Responses', value: '100 / month' },
      { label: 'Team members', value: '2' },
      { label: 'File storage', value: '100 MB' },
    ],
  },
  {
    name: 'Team',
    price: '$29',
    cadence: '/ month',
    description: 'For a team running data collection as an ongoing part of the work.',
    cta: { label: 'Get started', href: '/signup?plan=team' },
    featured: true,
    limits: [
      { label: 'Forms', value: '100' },
      { label: 'Responses', value: '10,000 / month' },
      { label: 'Team members', value: '50' },
      { label: 'File storage', value: '5 GB' },
    ],
  },
  {
    name: 'Organization',
    price: 'Talk to us',
    description: 'Higher ceilings, several workspaces, and a shared reference dictionary across them.',
    cta: { label: 'Contact us', href: '/contact' },
    limits: [
      { label: 'Forms', value: 'Agreed with you' },
      { label: 'Responses', value: 'Agreed with you' },
      { label: 'Team members', value: 'Agreed with you' },
      { label: 'File storage', value: 'Agreed with you' },
    ],
  },
];

/** Everything here is on every plan, including the free one. */
const INCLUDED = [
  'All eighteen field types',
  'Multi-page forms',
  'Stacked, conversational and grid layouts',
  'Conditional logic',
  'The rules engine — calculations, conditional requiredness, cross-field validation',
  'Managed option lists, CSV upload and cascading dropdowns',
  'Lookups and auto-fill',
  'Versioned publishing',
  'Password protection, sign-in requirement, expiry and response caps',
  'Saved respondent progress',
  'Response inbox, filtering and CSV export',
  'Analytics — views, starts, completion and drop-off',
  'Signed webhooks with retries and delivery history',
  'Data apps — record types, steps, records and timeline',
  'Admin, Editor and Viewer roles',
  'Audit log',
  'Two-factor authentication',
  'Theme and branding',
];

const FAQS = [
  {
    question: 'Which features are locked behind a paid plan?',
    answer:
      'None. Every plan gets the whole product — the rules engine, option lists, data apps, webhooks, roles and the audit log included. Plans differ only in how many forms, responses, members and files a workspace can hold.',
  },
  {
    question: 'What happens when I reach a limit?',
    answer:
      'A form that hits a response cap you set closes itself and says so. Workspace limits are enforced when you go to create something new, not by silently dropping responses that are already coming in.',
  },
  {
    question: 'Can I change plan later?',
    answer:
      'Yes, in either direction. Moving down means the workspace has to fit within the smaller limits before the change applies.',
  },
  {
    question: 'Who owns the responses?',
    answer:
      'You do. Export them to CSV whenever you like, and delete them — individually or entirely — whenever you like.',
  },
  {
    question: 'Do you offer a discount for non-profits or education?',
    answer: (
      <>
        Yes. <Link href="/contact" className="font-medium text-primary hover:underline">Tell us
        about the work</Link> and we will sort something out.
      </>
    ),
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title={
          <>
            Same product on <Marked>every plan</Marked>
          </>
        }
        lead="There is no feature-gated tier here. What differs between plans is how much a workspace can hold — forms, responses, people and files. Start free and move up when you outgrow it."
      />

      <Section pattern>
        <RevealGroup className="grid gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <RevealItem
              key={plan.name}
              className={cn(
                'flex flex-col rounded-2xl border bg-card p-7 shadow-card',
                'transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-lg',
                'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                plan.featured ? 'border-primary ring-1 ring-primary/20' : 'border-border',
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-xl font-bold tracking-tight text-foreground">
                  {plan.name}
                </h2>
                {plan.featured && (
                  <span className="rounded-full bg-brand-blush px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-brand-ember">
                    Most teams
                  </span>
                )}
              </div>

              <p className="mt-2 min-h-[2.75rem] text-sm leading-relaxed text-muted-foreground">
                {plan.description}
              </p>

              <p className="mt-6 flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-bold tracking-tight text-foreground">
                  {plan.price}
                </span>
                {plan.cadence && (
                  <span className="text-sm text-muted-foreground">{plan.cadence}</span>
                )}
              </p>

              <Link
                href={plan.cta.href}
                className={cn(
                  buttonVariants({
                    variant: plan.featured ? 'default' : 'outline',
                    size: 'lg',
                  }),
                  'mt-6 w-full',
                )}
              >
                {plan.cta.label}
              </Link>

              <dl className="mt-8 space-y-3 border-t border-border pt-6">
                {plan.limits.map((limit) => (
                  <div key={limit.label} className="flex items-baseline justify-between gap-4">
                    <dt className="text-sm text-muted-foreground">{limit.label}</dt>
                    <dd className="text-sm font-medium text-foreground">{limit.value}</dd>
                  </div>
                ))}
              </dl>
            </RevealItem>
          ))}
        </RevealGroup>

        <p className="mt-8 text-sm text-muted-foreground">
          Prices exclude any sales tax that applies where you are.
        </p>
      </Section>

      <Section tone="muted">
        <SectionHeading
          eyebrow="Included everywhere"
          title="On the free plan too"
          lead="This is the complete list, not the highlights. If it is in the product, it is on your plan."
        />

        <RevealGroup as="ul" className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
          {INCLUDED.map((item) => (
            <RevealItem key={item} as="li" className="flex items-start gap-3">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2.25} aria-hidden />
              <span className="text-sm leading-relaxed text-muted-foreground">{item}</span>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section>
        <SectionHeading eyebrow="Questions" title="Before you decide" />
        <Faq items={FAQS} />
      </Section>

      <CallToAction
        title="Start on the free plan"
        lead="No card, and nothing to remove later — the free workspace is the same product with smaller ceilings."
      />
    </>
  );
}
