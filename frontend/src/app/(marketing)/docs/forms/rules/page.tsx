import type { Metadata } from 'next';

import {
  Callout,
  Code,
  DocLinkGrid,
  DocPage,
  DocSectionBlock,
  DocTable,
  P,
  Term,
} from '@/components/docs/primitives';
import { ExprBreakdown, MockRuleCard } from '@/components/docs/builder-ui';
import { flatDocs } from '@/config/docs';

export const metadata: Metadata = { title: 'Rules and calculations' };

const OPERATORS_PAGE = flatDocs().find((p) => p.href === '/docs/forms/rules/operators')!;
const EXAMPLES_PAGE = flatDocs().find((p) => p.href === '/docs/forms/rules/examples')!;

export default function RulesPage() {
  return (
    <DocPage
      href="/docs/forms/rules"
      title="Rules and calculations"
      intro={
        <>
          Rules make your form intelligent without writing any code. Compute a field&apos;s value
          from other answers, show or hide a question based on a condition, make a question required
          only in certain situations, or reject a combination of answers that cannot be correct.
          Every rule is built visually in the rule editor and checked in full when you publish —
          the two pages below cover the complete operator set and walk through several rules line
          by line.
        </>
      }
    >
      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="The four rule kinds">
        <P>
          Every rule has exactly one <Term>kind</Term>, chosen from the same four the rule editor
          offers. Each card below is the actual editor UI, populated with a realistic example.
        </P>

        <div className="grid gap-4 sm:grid-cols-2">
          <MockRuleCard
            kind="CALCULATE"
            target="age_years"
            formula="yearsBetween(date_of_birth, today())"
          >
            <ExprBreakdown
              lines={[
                {
                  code: 'yearsBetween(date_of_birth, today())',
                  note: 'Whole years elapsed between the date of birth answer and today. The respondent cannot edit age_years directly — this formula owns its value.',
                },
              ]}
            />
          </MockRuleCard>

          <MockRuleCard
            kind="SHOW"
            target="additional_id"
            formula="gt(household_size, 6)"
          >
            <ExprBreakdown
              lines={[
                {
                  code: 'gt(household_size, 6)',
                  note: 'True once household_size is answered with a number greater than 6. additional_id stays hidden, and unasked, until then.',
                },
              ]}
            />
          </MockRuleCard>

          <MockRuleCard
            kind="REQUIRE"
            target="guardian_name"
            formula="lt(applicant_age, 18)"
          >
            <ExprBreakdown
              lines={[
                {
                  code: 'lt(applicant_age, 18)',
                  note: 'guardian_name becomes mandatory only when applicant_age is under 18. An adult applicant never sees it marked required.',
                },
              ]}
            />
          </MockRuleCard>

          <MockRuleCard
            kind="VALIDATE"
            target="end_date"
            formula="not(gt(end_date, start_date))"
            message="End date must be after the start date."
          >
            <ExprBreakdown
              lines={[
                {
                  code: 'not(gt(end_date, start_date))',
                  note: 'Validate is inverted — this describes the WRONG case. Submission is blocked whenever end_date is not after start_date, and the message appears beside end_date.',
                },
              ]}
            />
          </MockRuleCard>
        </div>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="How expressions work">
        <P>
          Expressions are trees built from four kinds of node, composed by choosing an operator and
          filling its inputs. Inputs can themselves be operators, field references, or constants.
          There is no text to type; the editor only offers operations the engine can evaluate.
        </P>
        <DocTable
          columns={['Node type', 'What it is', 'Example']}
          rows={[
            [
              <Term key="l">Literal</Term>,
              'A constant value you type in. Can be text, a number, true/false, or a list.',
              <span key="le"><Code>&quot;Male&quot;</Code>, <Code>18</Code>, <Code>true</Code>, <Code>[&quot;a&quot;,&quot;b&quot;]</Code></span>,
            ],
            [
              <Term key="f">Field</Term>,
              "The current answer to a question on this form, addressed by the question's key.",
              <span key="fe"><Code>date_of_birth</Code>, <Code>school_name</Code></span>,
            ],
            [
              <Term key="ref">Cross-form reference</Term>,
              'An answer from another form for the same subject (record-type forms only). Resolved before evaluation — the interpreter never touches a database.',
              <Code key="refe">registration@latest.district</Code>,
            ],
            [
              <Term key="o">Operation</Term>,
              'Application of a built-in operator to one or more inputs.',
              <Code key="oe">yearsBetween(date_of_birth, today())</Code>,
            ],
          ]}
        />
        <Callout type="note" title="Blank propagation">
          If any input to an operator is blank (question unanswered, lookup found nothing), the
          output is blank too. Blank is treated as <Code>false</Code> in Show, Require, and
          Validate, and as &ldquo;no value&rdquo; in Calculate. Operators never throw — bad input
          yields blank, not an error.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="What counts as true">
        <P>
          Show, Require, and Validate treat the expression result as a boolean:
        </P>
        <DocTable
          columns={['Value', 'Treated as']}
          rows={[
            [<Code key="t">true</Code>, 'True'],
            [
              <span key="f"><Code>false</Code>, <Code>null</Code> (blank), <Code>&quot;&quot;</Code> (empty text), <Code>[]</Code> (empty list)</span>,
              'False',
            ],
            [
              <Code key="z">0</Code>,
              'True — the number zero is a real answer, not the same as unanswered',
            ],
            ['Any non-empty string', 'True'],
            ['Any non-empty list', 'True'],
            ['Any non-zero number', 'True'],
          ]}
        />
        <Callout type="warning" title="Zero is truthy">
          Unlike JavaScript, <Code>0</Code> is truthy. <Code>isFilled(children_count)</Code> is{' '}
          <Code>true</Code> when the answer is 0. Use <Code>isBlank()</Code> to check whether a
          question was skipped entirely.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Rules vs. conditional logic">
        <P>
          The builder has two ways to make questions conditional:{' '}
          <Term>Conditional Logic</Term> (the simpler panel) and <Term>Rules</Term> (this page).
          Both can show or hide questions, but they are not duplicates.
        </P>
        <DocTable
          columns={['Capability', 'Conditional logic', 'Rules']}
          rows={[
            ['Show / hide a question', 'Yes', 'Yes — Show kind'],
            ['Skip to a page', 'Yes', 'No'],
            ['Calculated fields', 'No', 'Yes — Calculate kind'],
            ['Conditional requirement', 'No', 'Yes — Require kind'],
            ['Cross-field validation', 'No', 'Yes — Validate kind'],
            ['Date arithmetic', 'No', 'Yes'],
            ['Option list lookups', 'No', 'Yes'],
            ['Cross-form references', 'No', 'Yes'],
            ['Nesting depth', 'One condition', 'Up to 24 levels'],
          ]}
        />
        <P>
          Use Conditional Logic for simple &ldquo;if the answer is X, show Y&rdquo; cases and for
          page-jump navigation. Use Rules when you need calculations, nested conditions, date
          arithmetic, lookups, or cross-form data.
        </P>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Go deeper">
        <DocLinkGrid pages={[OPERATORS_PAGE, EXAMPLES_PAGE]} />
      </DocSectionBlock>
    </DocPage>
  );
}
