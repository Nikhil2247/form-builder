import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Accessibility,
  DatabaseZap,
  FileLock2,
  KeyRound,
  Network,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

import {
  CallToAction,
  CardGrid,
  FactGrid,
  FeatureCard,
  Marked,
  PageHero,
  Reveal,
  Section,
  SectionHeading,
} from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Security',
  description:
    'The security measures Formora implements, stated plainly — and an explicit list of the certifications we do not hold.',
};

/**
 * Security.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why this page was rewritten, and why it matters more than the others ──
 * The previous version of this page asserted, in headings, that Formora is
 * "HIPAA Compliant" with Business Associate Agreements available, holds a
 * "SOC 2 Type II" certification renewed by annual third-party audit, meets
 * "WCAG 2.1 AA" out of the box, and offers "EU data residency options" and
 * "built-in consent management" for GDPR and CCPA.
 *
 * None of that is true. There is no audit, no certification, no BAA, no
 * residency choice and no consent-management feature in the product.
 *
 * Everywhere else on this site an overclaim is a marketing problem. Here it is
 * not: a clinic reading that page could reasonably have concluded it was
 * permitted to put patient data into this system, and a procurement process
 * could have accepted "SOC 2 Type II" as a control it no longer needed to
 * verify. Those are decisions made on the strength of a sentence that had
 * nothing behind it.
 *
 * So this page now does two things: states what is genuinely implemented —
 * which is a substantial list — and says explicitly what we do not hold, so
 * that nobody has to infer it from an absence.
 */

/** Named individually and negatively, so no one has to read between lines. */
const NOT_HELD = [
  {
    term: 'SOC 2 (Type I or Type II)',
    detail: 'We have not been audited and hold no report. Do not list us as a SOC 2 vendor.',
  },
  {
    term: 'HIPAA / BAA',
    detail:
      'We do not sign Business Associate Agreements and are not a HIPAA-compliant processor. Do not put protected health information into Formora.',
  },
  {
    term: 'ISO 27001',
    detail: 'No certification, and no audit in progress.',
  },
  {
    term: 'PCI DSS',
    detail:
      'We never handle cardholder data. Do not build a form that collects card numbers — the platform is not designed to receive them.',
  },
  {
    term: 'Data residency',
    detail:
      'You cannot currently choose the region your data is stored in. Ask us where it is and we will tell you.',
  },
  {
    term: 'Independent accessibility audit',
    detail:
      'The interface is built to be operable by keyboard and screen reader, but no third party has certified it against WCAG.',
  },
];

export default function CompliancePage() {
  return (
    <>
      <PageHero
        eyebrow="Security"
        title={
          <>
            What we actually <Marked>do and do not</Marked> do
          </>
        }
        lead="This page is written to be checkable. Everything in the first half is implemented in the product today. The second half lists, by name, the certifications and guarantees we do not hold — because the useful version of this page is the one you can rely on during procurement."
      />

      {/* ── Implemented ─────────────────────────────────────────────────── */}
      <Section pattern>
        <SectionHeading
          eyebrow="Implemented"
          title="Measures that are in place"
          lead="Engineering controls that exist in the running system, not intentions."
        />

        <CardGrid>
          <FeatureCard icon={KeyRound} title="Authentication">
            Passwords hashed with a memory-hard algorithm, optional TOTP two-factor with single-use
            recovery codes, and rate limiting on sign-in, two-factor and password reset that is
            shared across servers rather than per-process.
          </FeatureCard>

          <FeatureCard icon={UserCheck} title="Sessions">
            A session lasts one day, fixed at sign-in, and nothing extends it in the background.
            When it ends you are signed out — in the tab you are sitting in, not just on the next
            request.
          </FeatureCard>

          <FeatureCard icon={ShieldCheck} title="Authorization">
            Every request is checked server-side for organization membership and role. The interface
            hides what you cannot do as a courtesy; the API is what actually refuses it.
          </FeatureCard>

          <FeatureCard icon={DatabaseZap} title="Tenant isolation">
            Data is scoped to one organization at every layer — forms, responses, files, option
            lists and exports. A member of one workspace cannot reach another&rsquo;s records by changing
            an identifier.
          </FeatureCard>

          <FeatureCard icon={FileLock2} title="Secrets and uploads">
            Webhook secrets and two-factor seeds are encrypted at rest with AES-256-GCM and are
            never returned by the API once set. Uploads are type- and extension-allowlisted, size
            capped at the storage layer, and re-verified against the stored object.
          </FeatureCard>

          <FeatureCard icon={Network} title="Outbound requests">
            Webhooks are HTTPS-only, with the destination resolved and checked at delivery time so
            it cannot point at a loopback, private or cloud-metadata address. Redirects are not
            followed and responses are truncated.
          </FeatureCard>

          <FeatureCard icon={ShieldCheck} title="Submission validation">
            Every submission is re-validated on the server against the published version — required
            fields, types, option membership, bounds and payload size — so a crafted request cannot
            write data the form does not permit.
          </FeatureCard>

          <FeatureCard icon={ScrollText} title="Audit log">
            Administrative actions are recorded with the actor, the resource and the detail:
            publishing, settings changes, membership changes and exports.
          </FeatureCard>

          <FeatureCard icon={Accessibility} title="Accessibility">
            Labels tied to their controls, error states announced to screen readers rather than
            shown only in red, grouped inputs in a real fieldset, and keyboard operability
            throughout. Built in, not independently audited — see below.
          </FeatureCard>
        </CardGrid>
      </Section>

      {/* ── Not held ────────────────────────────────────────────────────── */}
      <Section tone="muted">
        <SectionHeading
          eyebrow="Not held"
          title="What we do not have"
          lead="Named explicitly. If a control you need is on this list, we are not the right choice for that workload yet, and we would rather you found out here than in an incident."
        />
        <FactGrid items={NOT_HELD} />
      </Section>

      {/* ── Your data ───────────────────────────────────────────────────── */}
      <Section>
        <SectionHeading eyebrow="Your data" title="What you can do without asking us" />

        <CardGrid className="grid gap-6 sm:grid-cols-2">
          <FeatureCard icon={DatabaseZap} title="Export it" href="/docs/responses">
            Every form&rsquo;s responses export to CSV from the response inbox, filtered or in full, at
            any time and without a support request.
          </FeatureCard>

          <FeatureCard icon={FileLock2} title="Delete it" href="/docs/responses">
            Delete individual responses or all of them. Deleting a form removes its responses with
            it. We do not retain a shadow copy for our own purposes.
          </FeatureCard>
        </CardGrid>

        <Reveal className="mt-10 rounded-2xl border border-border bg-card p-6 shadow-card">
          <p className="text-sm leading-relaxed text-muted-foreground">
            We do not sell your data, mine it for our own analytics, or use responses to train any
            model. What we process, we process to run the service you are using it for. If you need
            a Data Processing Agreement,{' '}
            <Link href="/contact" className="font-medium text-primary hover:underline">
              ask us
            </Link>{' '}
            and we will tell you honestly what we can and cannot sign today.
          </p>
        </Reveal>
      </Section>

      {/* ── Reporting ───────────────────────────────────────────────────── */}
      <Section tone="muted">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:gap-16">
          <Reveal>
            <div className="mb-5 flex size-11 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <ShieldAlert className="size-5" strokeWidth={1.75} aria-hidden />
            </div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
              Found a vulnerability?
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
              Tell us before you tell anyone else, and we will work the fix with you.
            </p>
          </Reveal>

          <Reveal className="rounded-2xl border border-border bg-card p-7 shadow-card">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Write to{' '}
              <a
                href="mailto:security@formora.app"
                className="font-medium text-primary hover:underline"
              >
                security@formora.app
              </a>{' '}
              with the steps to reproduce, what you were able to access, and how you found it. We
              will acknowledge within two working days and keep you updated until it is closed.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Please do not run automated scanners against production, access data belonging to
              anyone else, or degrade the service for other users while testing. Give us a
              reasonable window to ship a fix before publishing.
            </p>
          </Reveal>
        </div>
      </Section>

      <CallToAction
        title="Questions we have not answered here?"
        lead="Security questionnaires, architecture questions, or where exactly your data sits — ask, and you will get a straight answer."
      />
    </>
  );
}
