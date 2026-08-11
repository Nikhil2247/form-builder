import type { Metadata } from 'next';

import {
  Callout,
  DocPage,
  DocSectionBlock,
  DocTable,
  P,
  Steps,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Record types' };

export default function RecordTypesPage() {
  return (
    <DocPage
      href="/docs/apps/record-types"
      title="Record types"
      intro={
        <>
          A record type defines the subject an app collects data about — a school, a patient, a
          household — and, crucially, how you tell one from another.
        </>
      }
    >
      <DocSectionBlock title="Creating one">
        <Steps
          items={[
            <>
              Open <UI>Configure → Record types</UI> and add one. Name it after the thing, singular:
              School, Patient, Household.
            </>,
            <>
              Choose its <Term>identity</Term> — which answers decide that two submissions are about
              the same subject.
            </>,
            <>
              Choose which answers are <Term>promoted</Term> onto the record as attributes.
            </>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Identity">
        <P>
          Identity is the part worth thinking about. It decides whether tomorrow&apos;s visit adds
          to an existing record or creates a second one for the same school.
        </P>
        <DocTable
          columns={['Approach', 'When it fits']}
          rows={[
            [
              'An external code',
              'Best when one exists — a UDISE code, a patient number, a registration id. Unambiguous, and it matches whatever system you already run.',
            ],
            [
              'A combination of answers',
              'Where no code exists. School name plus block plus district, for instance. Choose fields that do not change.',
            ],
            [
              'No identity',
              'Every session creates a new record. Only right when the subject genuinely is one-off.',
            ],
          ]}
        />
        <Callout type="warning" title="Duplicates are advisory, not blocking">
          When a session looks like it matches an existing record, the operator is shown the match
          and decides. The system never merges silently — an automatic merge that gets it wrong
          fuses two schools&apos; histories together, and untangling that is far worse than a
          duplicate.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Promoted attributes">
        <P>
          A record shows a handful of attributes at the top — the district, the block, the
          designation. These are <Term>promoted</Term> from answers on the registering form.
        </P>
        <P>
          Promote what you would want to see when scanning a list of records, and what you would
          want to filter by. Everything else stays in the responses and is still readable on the
          timeline; promoting all of it turns the record header into a second copy of the form.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="How a form relates to a record type">
        <P>Each step form declares its relationship:</P>
        <DocTable
          columns={['Role', 'Meaning']}
          rows={[
            [
              'Registers',
              'This form identifies or creates the record. Usually the first step, and usually where identity fields live.',
            ],
            [
              'Attaches',
              'This form is filed against a record that already exists in the session.',
            ],
            [
              'None',
              'The form is not tied to the subject — a session-level note, say.',
            ],
          ]}
        />
        <P>
          Being bound to a record type is also what makes cross-form references legal: a later form
          can read an answer given on an earlier one <em>for the same record</em>. Without a record
          type there is no subject to look the value up against.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
