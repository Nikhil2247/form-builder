import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, LifeBuoy, Mail, ShieldAlert, Users } from 'lucide-react';

import {
  CallToAction,
  CardGrid,
  Faq,
  FeatureCard,
  Marked,
  PageHero,
  Reveal,
  Section,
  SectionHeading,
} from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'How to reach us — support, sales, security reports and account questions — and what to include so the first reply is a useful one.',
};

/**
 * Contact.
 *
 * ── Why there is no form on this page ─────────────────────────────────────
 * There used to be one. It had `onSubmit={(e) => e.preventDefault()}` and a
 * `type="button"` submit control, so filling it in and pressing Send did
 * precisely nothing — no request, no error, no acknowledgement. A visitor with
 * a real problem would have typed it out, sent it into a void, and waited for
 * a reply that was never coming. That is materially worse than having no form,
 * and it is why this page now routes people somewhere that actually reaches a
 * person.
 *
 * Restoring a form here is a small job once there is an endpoint behind it:
 * an API route that validates and delivers the message, plus rate limiting so
 * it cannot be used as a relay. Until that exists, an address is honest and a
 * form is not.
 *
 * The office address the page used to print — "123 Innovation Drive, San
 * Francisco" — was placeholder text from a template and has been removed
 * rather than replaced with a different invention.
 */

const ROUTES = [
  {
    icon: LifeBuoy,
    title: 'Support',
    address: 'support@impactlens.app',
    body: 'Something is broken, behaving oddly, or you cannot work out how to make it do what you need.',
  },
  {
    icon: Users,
    title: 'Sales and plans',
    address: 'sales@impactlens.app',
    body: 'Higher limits, several workspaces, invoicing, or a non-profit and education discount.',
  },
  {
    icon: ShieldAlert,
    title: 'Security',
    address: 'security@impactlens.app',
    body: 'Reporting a vulnerability. Please include the steps to reproduce it, and give us a reasonable window to fix it before disclosing.',
  },
  {
    icon: Mail,
    title: 'Everything else',
    address: 'hello@impactlens.app',
    body: 'Partnerships, press, or anything that does not fit the boxes above.',
  },
];

const FAQS = [
  {
    question: 'What should I include in a support message?',
    answer:
      'The workspace name, a link to the form or app in question, what you expected to happen, and what happened instead. A screenshot of the moment it went wrong usually saves an entire round trip.',
  },
  {
    question: 'Something is wrong with a published form and respondents are affected.',
    answer:
      'Say so in the subject line and include the public link. In the meantime, you can close the form to new responses from its settings without deleting anything already collected.',
  },
  {
    question: 'Can I get my data out?',
    answer: (
      <>
        Yes, without asking us. Every form&apos;s responses export to CSV from the response inbox —
        see <Link href="/docs/responses" className="font-medium text-primary hover:underline">the
        responses documentation</Link>.
      </>
    ),
  },
  {
    question: 'I have forgotten which email my account uses.',
    answer:
      'Ask whoever administers your workspace — they can see the members list. If you are the administrator and locked out, write to support from any address and we will work it out with you.',
  },
];

export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title={
          <>
            Talk to <Marked>a person</Marked>
          </>
        }
        lead="Pick the address that matches what you need and you will skip a triage step. We answer during UK working hours, usually within one business day."
      />

      <Section pattern>
        <SectionHeading eyebrow="Where to write" title="Four addresses, so your message lands correctly" />

        <CardGrid className="grid gap-6 sm:grid-cols-2">
          {ROUTES.map((route) => (
            <FeatureCard key={route.title} icon={route.icon} title={route.title}>
              {route.body}
              <a
                href={`mailto:${route.address}`}
                className="mt-3 block font-medium text-primary hover:underline"
              >
                {route.address}
              </a>
            </FeatureCard>
          ))}
        </CardGrid>
      </Section>

      <Section tone="muted">
        <SectionHeading
          eyebrow="Before you write"
          title="These may be faster"
          lead="Most questions are answered in the documentation, and most account questions can be settled by whoever administers your workspace."
        />

        <CardGrid className="grid gap-6 sm:grid-cols-2">
          <FeatureCard icon={BookOpen} title="The documentation" href="/docs">
            Every feature, written out properly — building forms, rules, option lists, publishing,
            responses, data apps and administration.
          </FeatureCard>

          <FeatureCard icon={Users} title="Your workspace administrator" href="/docs/team">
            Invitations, roles, removing someone, and workspace settings are all in the hands of an
            Admin on your own team, which is usually a much shorter path than ours.
          </FeatureCard>
        </CardGrid>
      </Section>

      <Section>
        <SectionHeading eyebrow="Common questions" title="Answered here" />
        <Faq items={FAQS} />
      </Section>

      <CallToAction
        title="Or just try it"
        lead="A workspace takes under a minute to create, and you can have a form published and shared before you finish writing the email."
      />
    </>
  );
}
