import type { Metadata } from 'next';

import {
  Callout,
  Code,
  DocLinkGrid,
  DocPage,
  DocSectionBlock,
  P,
  Steps,
  Term,
  UI,
} from '@/components/docs/primitives';
import {
  ExprBreakdown,
  MockCanvas,
  MockFieldRow,
  MockRuleCard,
  MockStepRow,
} from '@/components/docs/builder-ui';
import { flatDocs } from '@/config/docs';

export const metadata: Metadata = { title: 'Build an app, step by step' };

const RECORD_TYPES_PAGE = flatDocs().find((p) => p.href === '/docs/apps/record-types')!;
const STEPS_PAGE = flatDocs().find((p) => p.href === '/docs/apps/steps')!;
const RECORDS_PAGE = flatDocs().find((p) => p.href === '/docs/apps/records')!;

export default function AppExamplesPage() {
  return (
    <DocPage
      href="/docs/apps/examples"
      title="Build an app, step by step"
      intro={
        <>
          One app, built end to end: a record type with a real identity, a registration step, a
          repeatable step scoped to a reporting period, an optional step with its own duplicate
          rule, and a rule that reads an earlier step&apos;s answer back on a later one. Every
          mechanic named below is covered on its own page — <UI>Record types</UI>, <UI>Steps</UI>{' '}
          and <UI>Records and timeline</UI> — this page is where they meet in one worked example.
        </>
      }
    >
      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="What we are building — a field monitoring app">
        <P>
          A field team visits schools on a quarterly cycle. The same school is visited again and
          again, issues get logged in between visits, and at the end of a quarter someone needs to
          see one school&apos;s whole history on one page rather than three separate response
          lists. That is exactly the shape a data app exists for.
        </P>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="1. The record type — School">
        <Steps
          items={[
            <>
              Create a record type named <Term>School</Term>.
            </>,
            <>
              Set its <Term>identity</Term> to the school&apos;s UDISE code when one is captured,
              falling back to the combination of school name, block and district when it is not —
              a real decision, not every field, and one that does not change between visits.
            </>,
            <>
              Promote <Code>district</Code>, <Code>block</Code> and <Code>school_name</Code> as{' '}
              <Term>attributes</Term>, so a list of Schools is scannable without opening each one.
            </>,
          ]}
        />
        <Callout type="tip" title="Why not the UDISE code alone">
          Not every school has one on day one of data collection. Falling back to name + block +
          district means a school can be registered correctly today and reconciled against its
          official code later, rather than blocking registration on a code the field worker does
          not have yet.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="2. Step one — School details (registers the record, once)">
        <P>
          The first step is what creates the record. It runs once per school, ever — visiting the
          same school again does not create a second one.
        </P>

        <MockStepRow
          index={1}
          title="School details"
          role="Registers"
          cardinality="Single"
          detail="Runs once per school. A second visit finds the existing record instead of creating another."
        />

        <MockCanvas title="Step 1 — School details">
          <MockFieldRow label="District" type="Select an option" detail="option list: districts" />
          <MockFieldRow label="Block" type="Select an option" detail="cascades from District" badges={['Cascading']} />
          <MockFieldRow label="School name" type="Select an option" detail="cascades from Block" badges={['Cascading']} />
          <MockFieldRow label="UDISE code" type="Short answer" detail="official code, if known" />
        </MockCanvas>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="2. Step two — Quarterly training visit (repeats, once per period)">
        <P>
          The second step is filed against the school this session resolved to in step one. It is{' '}
          <Term>repeatable</Term>, but scoped to the current reporting period — one training visit
          per school, per quarter, enforced as a real constraint rather than a convention field
          workers are trusted to follow.
        </P>

        <MockStepRow
          index={2}
          title="Quarterly training visit"
          role="Attaches"
          cardinality="Repeatable"
          detail="Once per school, per open period. A second attempt in the same quarter is rejected rather than silently double-counted."
        />

        <MockCanvas title="Step 2 — Quarterly training visit">
          <MockFieldRow label="Visit date" type="Date" badges={['Required']} />
          <MockFieldRow
            label="District"
            type="Short answer"
            detail="read-only, filled from the registration step"
            badges={['Calculated']}
          />
          <MockFieldRow label="Topics covered" type="Choose all that apply" />
          <MockFieldRow label="Attendance count" type="Number" />
        </MockCanvas>

        <P>
          The read-only District field is the piece that ties the two steps together — it is not
          re-asked, it is read back:
        </P>

        <MockRuleCard
          index={1}
          kind="CALCULATE"
          target="visit_district"
          formula="district@registration"
        >
          <ExprBreakdown
            lines={[
              {
                code: 'district@registration',
                note: 'A cross-form reference: the district answer from the submission that registered this school — the "Registration" reading, not "Latest" — so it always shows what the school was registered under, even if a later edit changes wording elsewhere.',
              },
            ]}
          />
        </MockRuleCard>

        <Callout type="note" title="Why Registration and not Latest">
          Both readings are available on any cross-form reference. <Term>Registration</Term> reads
          the submission that created the record, which is right for a fact that should not drift
          — this school&apos;s district. <Term>Latest</Term> would instead be right for something
          the field team deliberately updates over time, like a contact person.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="3. Step three — Site issue log (optional, repeats, no duplicate date)">
        <P>
          Not every visit turns up an issue, and an issue can be logged between visits, not only
          during one — so this step is <Term>optional</Term> and scoped to the record&apos;s whole
          history rather than to a single period or session.
        </P>

        <MockStepRow
          index={3}
          title="Site issue log"
          role="Attaches"
          cardinality="Repeatable"
          detail="Optional. Scoped to the school's full history, not just this quarter — logged whenever an issue occurs."
          badges={['Optional']}
        />

        <MockCanvas title="Step 3 — Site issue log">
          <MockFieldRow label="Issue date" type="Date" badges={['Required']} />
          <MockFieldRow label="Description" type="Long answer" />
          <MockFieldRow label="Resolved" type="Choose one" detail="Yes / No" />
          <MockFieldRow label="Photo" type="File upload" />
        </MockCanvas>

        <Callout type="tip" title="One entry per date, not per session">
          The step&apos;s duplicate check is set to the issue date rather than left to count entries —
          logging two different problems on two different days is normal, but the same date
          appearing twice usually means the same issue was logged twice. Getting this identity
          right on the step is what makes Add safe to press without worrying about double-counting.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="What the record shows afterward">
        <P>
          Open the School record for this school and the three steps appear as one timeline,
          newest first: every quarterly visit, every issue logged in between, each entry showing
          the form it came from and when it arrived. District, block and school name sit at the
          top as the promoted attributes chosen in step one — the same three fields on every visit
          and issue entry, without re-typing them each time.
        </P>
        <P>
          Next quarter, the same public link resolves to the same record, step two opens again
          because a new period is open, and step one does not — the school is already registered.
        </P>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Go deeper">
        <DocLinkGrid pages={[RECORD_TYPES_PAGE, STEPS_PAGE, RECORDS_PAGE]} />
      </DocSectionBlock>
    </DocPage>
  );
}
