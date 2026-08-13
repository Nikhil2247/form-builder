import type { Metadata } from 'next';
import Link from 'next/link';
import {
  BarChart3,
  Braces,
  Building2,
  CalendarClock,
  FileSpreadsheet,
  FileText,
  GitBranch,
  History,
  KeyRound,
  Layers,
  ListTree,
  Lock,
  ScrollText,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Webhook,
} from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import {
  CallToAction,
  CardGrid,
  FactGrid,
  FeatureCard,
  FeatureRow,
  Marked,
  PageHero,
  RevealGroup,
  RevealItem,
  Section,
  SectionHeading,
} from '@/components/marketing/primitives';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'A form builder with a real rules engine, managed option lists, immutable published versions, multi-step data apps, and role-based administration.',
};

/**
 * What the product actually does.
 *
 * Everything on this page is a feature that exists in the application and is
 * documented under /docs. The previous version of this page advertised SOC 2
 * and HIPAA certification, SSO via SAML and OIDC, AI form generation, PDF
 * report generation, Zapier and Make integrations, and automatic right-to-left
 * multi-language support. None of those are built. Claiming a compliance
 * certification you do not hold is not an exaggeration, it is a
 * misrepresentation someone may make a purchasing decision on, so the whole
 * set is gone rather than softened.
 *
 * The real feature surface is considerably more interesting than the invented
 * one, and it is what this page describes.
 */

const FIELD_TYPES = [
  'Short text',
  'Long text',
  'Number',
  'Email',
  'Phone',
  'URL',
  'Single choice',
  'Multiple choice',
  'Dropdown',
  'Star rating',
  'NPS',
  'Slider',
  'Date',
  'File upload',
  'Signature',
  'Matrix',
  'Section header',
  'Repeating section',
];

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title={
          <>
            A form builder that can hold a <Marked>real process</Marked>
          </>
        }
        lead="Most form tools stop at fields and a submit button. Formora adds the parts a working data-collection process actually needs: rules that compute and validate across questions, reference data managed in one place, versioned publishing, and a way to follow the same subject across many forms over time."
        actions={
          <>
            <Link href="/signup" className={buttonVariants({ size: 'lg' })}>
              Get started
            </Link>
            <Link href="/docs" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
              Read the documentation
            </Link>
          </>
        }
      />

      {/* ── The four things that make it different ──────────────────────── */}
      <Section>
        <SectionHeading
          eyebrow="In depth"
          title="The four capabilities worth choosing it for"
          lead="Each of these has a documentation section of its own. These are the summaries."
        />

        <div className="divide-y divide-border">
          <FeatureRow
            eyebrow="Rules and logic"
            title="Questions that compute, require and validate each other"
            lead="Conditional logic shows and hides questions. Rules go further: they derive values, make a field required only in the situations where it matters, and enforce constraints that span several answers at once. Rules are written against stable question keys, so renaming a label never breaks a formula."
            href="/docs/forms/rules"
            points={[
              {
                term: 'Calculated fields',
                detail:
                  'A question whose value is derived — an age from a date of birth, a total from line items. The respondent sees it fill in as they answer, read-only rather than as an empty box.',
              },
              {
                term: 'Conditional requiredness',
                detail:
                  '"Required only when the answer to something else was X", without turning one question into three near-duplicates.',
              },
              {
                term: 'Cross-question validation',
                detail:
                  'An end date before its start date, a total that must match its parts. The message appears against the field it concerns.',
              },
              {
                term: 'Re-run on the server',
                detail:
                  'The browser evaluates rules for immediate feedback; the API evaluates the identical compiled plan again and its result is what gets stored. Client-supplied values for calculated fields are discarded.',
              },
            ]}
          />

          <FeatureRow
            reverse
            eyebrow="Option lists"
            title="Reference data managed once, used everywhere"
            lead="A list of 784 districts does not belong pasted into a dropdown on four different forms. Option lists hold that data centrally, upload from CSV, and bind to any choice question — so correcting a spelling fixes it everywhere at once."
            href="/docs/option-lists"
            points={[
              {
                term: 'Cascading dropdowns',
                detail:
                  'District narrows Block, Block narrows School. Each level offers only the options belonging to the answer above it.',
              },
              {
                term: 'Lookups and auto-fill',
                detail:
                  'Attach metadata to a list item and pull it into other fields when that item is chosen — a code, a region, a contact.',
              },
              {
                term: 'Searchable at any size',
                detail:
                  'Large lists become type-to-search automatically rather than a select someone has to scroll for a minute.',
              },
              {
                term: 'Organization or platform scope',
                detail:
                  'Keep a list to one workspace, or publish a shared dictionary that every workspace can draw on.',
              },
            ]}
          />

          <FeatureRow
            eyebrow="Publishing"
            title="Published versions are immutable, and responses remember theirs"
            lead="Publishing freezes a version of the form. Editing afterwards changes the draft, not what respondents are currently filling in, until you publish again. Every response records the version it was submitted against, so an answer is always readable against the questions that were actually asked."
            href="/docs/publishing"
            points={[
              {
                term: 'Draft and live are separate',
                detail:
                  'The builder shows unpublished changes explicitly, so nobody discovers a half-finished edit went live an hour ago.',
              },
              {
                term: 'Responses bind to a version',
                detail:
                  'Reworded a question last month? Older responses still display against the wording their respondent saw.',
              },
              {
                term: 'Access controls on the link',
                detail:
                  'Password protection, sign-in requirement, an expiry date, a response cap that closes the form on its own, and one-response-per-person.',
              },
            ]}
          />

          <FeatureRow
            reverse
            eyebrow="Data apps"
            title="Many forms about the same subject, over time"
            lead="A monitoring visit is not one form. It is a respondent block, then a section repeated per school visited, then a summary — and next quarter the same subject is visited again. A data app is one link that walks a field worker through that whole sequence and files the result under the subject it concerns."
            href="/docs/apps"
            points={[
              {
                term: 'Record types',
                detail:
                  'Define the subject an app collects data about — a school, a household, a patient — and what identifies it.',
              },
              {
                term: 'Ordered, repeatable, conditional steps',
                detail:
                  'Each step is a form, filled once or any number of times, with minimums and maximums, and skipped entirely when it does not apply.',
              },
              {
                term: 'Records and timeline',
                detail:
                  'Everything ever collected about one subject, in one place, in the order it happened.',
              },
            ]}
          />
        </div>
      </Section>

      {/* ── Builder ─────────────────────────────────────────────────────── */}
      <Section tone="muted">
        <SectionHeading
          eyebrow="The builder"
          title="Everything else in the box"
          lead="The parts you would expect, listed rather than implied."
        />

        <CardGrid>
          <FeatureCard icon={Shapes} title="Eighteen field types" href="/docs/forms/fields">
            From short text to matrices, signatures, file uploads and repeating sections — each
            storing a defined shape rather than a string that happens to look right.
          </FeatureCard>

          <FeatureCard icon={Layers} title="Three layouts" href="/docs/forms/layout">
            Stacked for a document, one-question-at-a-time for a conversation, or a two-column grid.
            In grid mode each field can take half a row or the whole one.
          </FeatureCard>

          <FeatureCard icon={GitBranch} title="Conditional logic" href="/docs/forms/logic">
            Show and hide questions based on earlier answers, and jump respondents past pages that
            do not apply to them.
          </FeatureCard>

          <FeatureCard icon={FileText} title="Multi-page forms" href="/docs/forms/layout">
            Split a long form into pages with their own titles, so a twenty-question form does not
            arrive as one intimidating scroll.
          </FeatureCard>

          <FeatureCard icon={SlidersHorizontal} title="Validation you define" href="/docs/forms/fields">
            Lengths, ranges, patterns, accepted file types and sizes — enforced in the browser and
            then enforced again by the API, which never trusts what the browser sent.
          </FeatureCard>

          <FeatureCard icon={Braces} title="Theme and branding" href="/docs/forms/theme">
            Colours, typography, a logo and a cover image, so a published form looks like it belongs
            to you rather than to us.
          </FeatureCard>
        </CardGrid>
      </Section>

      {/* ── After submission ────────────────────────────────────────────── */}
      <Section>
        <SectionHeading
          eyebrow="Responses"
          title="What happens after someone presses submit"
        />

        <CardGrid>
          <FeatureCard icon={ListTree} title="Response inbox" href="/docs/responses">
            Filter, search and open any response in full, with each answer shown against the
            question as it was worded at the time.
          </FeatureCard>

          <FeatureCard icon={FileSpreadsheet} title="CSV export" href="/docs/responses">
            Export what you filtered to, not just everything. Values are escaped so a spreadsheet
            treats them as data rather than as formulas.
          </FeatureCard>

          <FeatureCard icon={BarChart3} title="Analytics" href="/docs/analytics">
            Views, starts, completion rate and where people abandon — enough to tell a form that is
            too long from one nobody found.
          </FeatureCard>

          <FeatureCard icon={Webhook} title="Signed webhooks" href="/docs/integrations">
            Every submission posted to your endpoint, signed so you can verify it came from us,
            retried on failure, with a delivery history you can inspect.
          </FeatureCard>

          <FeatureCard icon={CalendarClock} title="Response caps and expiry" href="/docs/forms/settings">
            Close a form automatically at a date, or after a set number of responses, without
            remembering to go and switch it off.
          </FeatureCard>

          <FeatureCard icon={History} title="Saved progress" href="/docs/responses">
            A long form remembers what a respondent had entered if they close the tab and come back
            to finish it.
          </FeatureCard>
        </CardGrid>
      </Section>

      {/* ── Administration ─────────────────────────────────────────────── */}
      <Section tone="muted">
        <SectionHeading
          eyebrow="Administration"
          title="Built for more than one person"
          lead="Workspaces, roles and an audit trail, because most data collection is something a team does together and someone is accountable for."
        />

        <CardGrid>
          <FeatureCard icon={Users} title="Roles that mean something" href="/docs/team">
            Admin, Editor and Viewer, enforced by the API on every request rather than by hiding
            buttons in the interface.
          </FeatureCard>

          <FeatureCard icon={Building2} title="Multiple workspaces" href="/docs/organization">
            Belong to several organizations and switch between them, holding a different role in
            each. Data never crosses between them.
          </FeatureCard>

          <FeatureCard icon={ScrollText} title="Audit log" href="/docs/organization">
            Who published what, who changed a setting, who exported responses — recorded, with the
            detail attached.
          </FeatureCard>
        </CardGrid>
      </Section>

      {/* ── Security ───────────────────────────────────────────────────── */}
      <Section>
        <SectionHeading
          eyebrow="Security"
          title="What we do, stated plainly"
          lead={
            <>
              These are engineering measures that are implemented, not certifications. See{' '}
              <Link href="/compliance" className="font-medium text-primary hover:underline">
                security and compliance
              </Link>{' '}
              for what we do and do not hold.
            </>
          }
        />

        <CardGrid>
          <FeatureCard icon={KeyRound} title="Two-factor authentication">
            TOTP from any authenticator app, with single-use recovery codes. Secrets are encrypted
            at rest, and turning it off requires the account password.
          </FeatureCard>

          <FeatureCard icon={ShieldCheck} title="Server-side answer validation">
            Every submission is re-validated against the published version: required fields, types,
            option membership, bounds, and payload size. The browser&rsquo;s word is never taken for it.
          </FeatureCard>

          <FeatureCard icon={Lock} title="Guarded outbound webhooks">
            HTTPS only, with addresses resolved and checked at delivery time so a webhook cannot be
            pointed at an internal or cloud-metadata address.
          </FeatureCard>
        </CardGrid>

        <div className="mt-14">
          <FactGrid
            items={[
              {
                term: 'Sessions',
                detail:
                  'One day, fixed at sign-in. Nothing extends it in the background; when it ends you are signed out.',
              },
              {
                term: 'Rate limiting',
                detail:
                  'Shared across servers, with stricter limits on sign-in, two-factor and password reset.',
              },
              {
                term: 'File uploads',
                detail:
                  'Type and extension allowlisted, size enforced at the storage layer, and checked against the actual stored object.',
              },
              {
                term: 'Tenant isolation',
                detail:
                  'Every request is scoped to one organization and checked server-side, including files and option lists.',
              },
              {
                term: 'Secrets at rest',
                detail:
                  'Webhook secrets and two-factor seeds are encrypted; the API never returns them once set.',
              },
              {
                term: 'Response data',
                detail:
                  'Yours. Exportable at any time, and deletable — including individual responses.',
              },
            ]}
          />
        </div>
      </Section>

      {/* ── Field types ─────────────────────────────────────────────────── */}
      <Section tone="muted" pattern>
        <SectionHeading
          eyebrow="Reference"
          title="Every field type"
          lead={
            <>
              What each one stores and when to reach for it is covered in{' '}
              <Link href="/docs/forms/fields" className="font-medium text-primary hover:underline">
                the field types documentation
              </Link>
              .
            </>
          }
        />
        <RevealGroup as="ul" className="flex flex-wrap gap-2">
          {FIELD_TYPES.map((type) => (
            <RevealItem
              key={type}
              as="li"
              className="rounded-full border border-border bg-card px-3.5 py-1.5 text-sm
                         text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              {type}
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <CallToAction />
    </>
  );
}
