import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarChart3,
  Building2,
  Calculator,
  GitBranch,
  Layers,
  ListTree,
  ShieldCheck,
  Webhook,
} from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import {
  CallToAction,
  CardGrid,
  Eyebrow,
  FeatureCard,
  Marked,
  PageHero,
  Reveal,
  RevealGroup,
  RevealItem,
  Section,
  SectionHeading,
} from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Formora — forms, rules and records for teams that collect real data',
  description:
    'Build forms with a real rules engine, managed option lists and versioned publishing. Follow the same subject across many forms over time with data apps.',
};

/**
 * The landing page.
 *
 * Rewritten from a template. The previous version opened with "Trusted by
 * 10,000+ teams worldwide" above a row of invented company names — Acme Corp,
 * GlobalTech, Quantum, Vertex, Nova Inc — and described the product only in
 * terms every form builder ever made could claim. Fabricated social proof is
 * the fastest way to lose a reader who checks, and the generic copy meant the
 * page never once said what this product does that others do not.
 *
 * What it says now is what the product is: forms whose questions can compute
 * and validate each other, reference data managed in one place, published
 * versions that responses stay readable against, and a way to follow one
 * subject across many forms over time.
 */

const STEPS = [
  {
    step: '01',
    title: 'Build it',
    body: 'Drag in the fields you need across as many pages as it takes. Add logic to hide what does not apply, and rules to calculate and cross-check the rest. Everything autosaves as you work.',
  },
  {
    step: '02',
    title: 'Publish it',
    body: 'Publishing freezes a version and gives you a link. Keep editing afterwards — the draft is yours to change, and respondents keep seeing the published version until you say otherwise.',
  },
  {
    step: '03',
    title: 'Read what comes back',
    body: 'Responses arrive against the version they were filled on. Filter them, export what you filtered to, watch where people drop off, and post each one to your own systems as it lands.',
  },
];

export default function LandingPage() {
  return (
    <>
      <PageHero
        eyebrow="Forms, rules and records"
        title={
          <>
            Collect data that <Marked>holds up</Marked> afterwards
          </>
        }
        lead="Formora is a form builder for work where the answers matter — monitoring visits, intake, assessments, field surveys. Questions can calculate and validate each other, dropdowns draw on reference data you manage in one place, and every response stays readable against the exact version of the form it was filled on."
        actions={
          <>
            <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
              Start building
            </Link>
            <Link href="/features" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              See what it does
            </Link>
          </>
        }
      />

      {/* ── The distinguishing four ─────────────────────────────────────── */}
      <Section pattern>
        <SectionHeading
          eyebrow="Why this one"
          title="Four things most form builders do not do"
          lead="Everything else on this page is table stakes. These are not."
        />

        <CardGrid className="grid gap-6 sm:grid-cols-2">
          <FeatureCard icon={Calculator} title="A real rules engine" href="/docs/forms/rules">
            Fields that derive their own value, requirements that depend on other answers, and
            validation across several questions at once — evaluated in the browser for immediate
            feedback and re-evaluated by the API, whose answer is the one stored.
          </FeatureCard>

          <FeatureCard icon={ListTree} title="Managed option lists" href="/docs/option-lists">
            Upload a list once and bind any dropdown to it. Cascade District into Block into School,
            and auto-fill related fields from whichever item was picked. Fix a spelling in one place
            and it is fixed on every form.
          </FeatureCard>

          <FeatureCard icon={Layers} title="Versioned publishing" href="/docs/publishing">
            A published version is immutable and every response records which one it belongs to.
            Reword a question next month and last month's answers still read against the wording
            their respondent actually saw.
          </FeatureCard>

          <FeatureCard icon={Building2} title="Data apps" href="/docs/apps">
            When one subject needs many forms over time — a school visited each quarter, a household
            surveyed in sections — an app walks the field worker through the whole sequence and
            files everything under the subject it concerns.
          </FeatureCard>
        </CardGrid>
      </Section>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <Section tone="muted">
        <SectionHeading eyebrow="How it works" title="Three steps, then it is running" />

        <RevealGroup as="ol" className="grid gap-8 lg:grid-cols-3">
          {STEPS.map((item) => (
            <RevealItem
              key={item.step}
              as="li"
              className="rounded-2xl border border-border bg-card p-7 shadow-card"
            >
              <span className="tabular text-sm font-semibold text-primary">{item.step}</span>
              <h3 className="mt-3 font-display text-xl font-bold tracking-tight text-foreground">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      {/* ── The rest ────────────────────────────────────────────────────── */}
      <Section>
        <SectionHeading
          eyebrow="Also included"
          title="The parts you would expect"
          lead={
            <>
              Covered properly rather than mentioned. Every one of these has{' '}
              <Link href="/docs" className="font-medium text-primary hover:underline">
                documentation
              </Link>{' '}
              behind it.
            </>
          }
        />

        <CardGrid className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureCard icon={GitBranch} title="Conditional logic" href="/docs/forms/logic">
            Show, hide and skip based on what someone has already answered.
          </FeatureCard>

          <FeatureCard icon={BarChart3} title="Analytics" href="/docs/analytics">
            Views, starts, completion rate, and the question people abandon on.
          </FeatureCard>

          <FeatureCard icon={Webhook} title="Signed webhooks" href="/docs/integrations">
            Each submission posted to your endpoint, signed, retried, and logged.
          </FeatureCard>

          <FeatureCard icon={ShieldCheck} title="Roles and audit" href="/docs/team">
            Admin, Editor and Viewer, enforced server-side, with a record of who did what.
          </FeatureCard>
        </CardGrid>
      </Section>

      {/* ── Who it is for ───────────────────────────────────────────────── */}
      <Section tone="muted" pattern>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
          <Reveal>
            <Eyebrow>Who it is for</Eyebrow>
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Built for the awkward forms
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              A contact form does not need any of this. These do — and they are the ones that
              usually end up in a spreadsheet nobody trusts.
            </p>
          </Reveal>

          <RevealGroup as="ul" className="space-y-4">
            {[
              {
                title: 'Field monitoring and M&E',
                body: 'Repeating sections per site visited, cascading location lists, and a record per subject that accumulates across quarters.',
              },
              {
                title: 'Intake and eligibility',
                body: 'Questions that appear only when they apply, requirements that depend on earlier answers, and eligibility computed as the form is filled.',
              },
              {
                title: 'Assessments and audits',
                body: 'Scored questions, cross-field checks that catch a contradiction at the point it is entered, and an immutable version behind every result.',
              },
              {
                title: 'Multi-team operations',
                body: 'Several workspaces, distinct roles per workspace, shared reference data, and an audit trail over all of it.',
              },
            ].map((item) => (
              <RevealItem
                key={item.title}
                as="li"
                className="rounded-xl border border-border bg-card p-5 shadow-card"
              >
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      </Section>

      <CallToAction />
    </>
  );
}
