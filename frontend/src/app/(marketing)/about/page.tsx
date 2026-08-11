import type { Metadata } from 'next';
import Link from 'next/link';
import { Eye, GitCommitHorizontal, Lock, Ruler } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import {
  CallToAction,
  CardGrid,
  FeatureCard,
  Marked,
  PageHero,
  Reveal,
  Section,
  SectionHeading,
} from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Why Formora exists: the awkward middle ground between a form tool that is too simple and a data system that takes six months to configure.',
};

/**
 * About.
 *
 * The previous version of this page told a story that had not happened — "In
 * 2023, our founders were working at a fast-growing startup…", "we're proud to
 * power data collection for thousands of innovative teams", "from small
 * non-profits to Fortune 500 enterprises" — and listed values the product does
 * not implement (multi-language support among them).
 *
 * An about page that invents a history is worse than one that is short. This
 * one says what the product is for and what it commits to, and claims no
 * customers, no funding round and no founding year, because there is nothing
 * here to substantiate any of them.
 */

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title={
          <>
            Built for the forms that <Marked>carry weight</Marked>
          </>
        }
        lead="Formora exists for the awkward middle ground: work too structured for a simple form tool, but nowhere near big enough to justify a data system that takes six months and a consultant to configure."
      />

      <Section pattern>
        <Reveal className="max-w-3xl">
          <h2 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            The gap this fills
          </h2>

          <div className="mt-6 space-y-5 text-lg leading-relaxed text-muted-foreground">
            <p>
              Most data collection ends up in one of two places. Either a general-purpose form tool,
              which handles the questions but nothing around them — no reference data, no way to
              compute a value from two answers, no memory of which version of the form a response
              belongs to — or a full data platform, which handles all of that and asks for a
              six-month implementation first.
            </p>
            <p>
              Between the two sits an enormous amount of real work. A monitoring visit with a
              repeating section per school. An intake form where three questions only apply to some
              applicants and one of them is calculated. A district list of several hundred entries
              that four different forms need to agree on. None of that is exotic, and all of it is
              exactly where a simple form tool runs out and a spreadsheet takes over.
            </p>
            <p>
              That is what this is for. The rules engine, the managed option lists, the immutable
              published versions and the record timeline are all answers to the same question: what
              does a form builder need before the data coming out of it can be trusted six months
              later?
            </p>
          </div>
        </Reveal>
      </Section>

      <Section tone="muted">
        <SectionHeading
          eyebrow="What we commit to"
          title="Four things we hold ourselves to"
          lead="Stated as commitments rather than values, because a commitment can be checked."
        />

        <CardGrid className="grid gap-6 sm:grid-cols-2">
          <FeatureCard icon={Eye} title="We describe what exists">
            Every capability on this site is built and documented. We do not list a feature as
            shipped because it is on a roadmap, and we do not claim a certification we do not hold —
            see <Link href="/compliance" className="font-medium text-primary hover:underline">security
            and compliance</Link> for exactly where we stand.
          </FeatureCard>

          <FeatureCard icon={Lock} title="Your data stays yours">
            Export it to CSV whenever you want and delete it whenever you want, in whole or one
            response at a time. We do not sell it, mine it, or train anything on it.
          </FeatureCard>

          <FeatureCard icon={GitCommitHorizontal} title="Answers stay readable">
            A published version is frozen and every response records the version it belongs to, so
            editing a form next year cannot quietly change what last year's data appears to say.
          </FeatureCard>

          <FeatureCard icon={Ruler} title="The interface is not the security">
            Permissions are enforced by the API on every request. Hiding a button is a courtesy to
            the user, never a control — and the two are never confused here.
          </FeatureCard>
        </CardGrid>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Getting in touch"
          title="Questions, or something not working?"
          lead="The documentation covers most of it. For anything else there is a person at the other end."
        />
        <Reveal className="flex flex-wrap gap-3">
          <Link href="/contact" className={buttonVariants({ size: 'lg' })}>
            Contact us
          </Link>
          <Link href="/docs" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
            Read the documentation
          </Link>
        </Reveal>
      </Section>

      <CallToAction />
    </>
  );
}
