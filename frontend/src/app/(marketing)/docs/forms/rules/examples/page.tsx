import type { Metadata } from 'next';

import { Callout, Code, DocPage, DocSectionBlock, DocTable, P } from '@/components/docs/primitives';
import { ExprBreakdown, MockRuleCard } from '@/components/docs/builder-ui';

export const metadata: Metadata = { title: 'Worked rule examples' };

export default function RuleExamplesPage() {
  return (
    <DocPage
      href="/docs/forms/rules/examples"
      title="Worked rule examples"
      intro={
        <>
          Three complete rules, each shown as the rule editor renders it and explained one
          expression node at a time — what it reads, what it computes, and why it is written that
          way rather than some other way that looks equivalent.
        </>
      }
    >
      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Example 1 — age from a date of birth">
        <P>
          A programme intake form asks for a date of birth and needs an age in whole years,
          displayed back to the respondent but never hand-typed by them — the two must never
          disagree.
        </P>

        <MockRuleCard kind="CALCULATE" target="age_years" formula="yearsBetween(date_of_birth, today())">
          <ExprBreakdown
            lines={[
              {
                code: 'today()',
                depth: 1,
                note: "Reads the instant the form is being evaluated against — the browser's clock while the respondent is typing, and the actual submission timestamp when the server re-checks it at submit. The two can disagree by the few seconds it took to fill in the rest of the form, which is never enough to change a whole year.",
              },
              {
                code: 'yearsBetween(date_of_birth, …)',
                note: 'Counts whole birthdays that have passed between date_of_birth and that instant — 17 years and 11 months returns 17, not 17.9.',
              },
            ]}
          />
        </MockRuleCard>

        <Callout type="tip" title="Why CALCULATE and not a plain Number field">
          A Number field the respondent fills in themselves can say anything. A CALCULATE field is
          read-only and re-derived by the server on submit, so age_years always agrees with
          date_of_birth — there is no path for the two to drift apart, accidentally or otherwise.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Example 2 — a follow-up that is only sometimes required">
        <P>
          The same intake form collects household size. Above six people, the programme&apos;s rules
          require a second form of identification for the extra household members — but asking
          every applicant for it, most of whom have small households, would be pure friction.
        </P>

        <MockRuleCard kind="REQUIRE" target="additional_id" formula="gt(household_size, 6)">
          <ExprBreakdown
            lines={[
              {
                code: 'gt(household_size, 6)',
                note: 'True once household_size holds a number greater than 6.',
              },
              {
                code: '→ REQUIRE additional_id',
                note: 'While the condition is false, additional_id is optional and can be left blank at submission — it only becomes mandatory once household_size crosses the threshold.',
              },
            ]}
          />
        </MockRuleCard>

        <Callout type="tip" title="Pair it with SHOW">
          Requiring a question the respondent cannot see would be unanswerable. In practice this
          REQUIRE rule is paired with a SHOW rule using the identical condition on the same
          question, so additional_id only appears — and only becomes mandatory — under the same
          circumstance.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Example 3 — rejecting a contradiction across two fields">
        <P>
          A monitoring visit form records a visit&apos;s start and end time. Neither field alone can
          be wrong, but the combination can be — an end time before the start time is a data-entry
          slip that should never reach the database.
        </P>

        <MockRuleCard
          kind="VALIDATE"
          target="end_time"
          formula="not(gt(end_time, start_time))"
          message="End time must be after the start time."
        >
          <ExprBreakdown
            lines={[
              {
                code: 'gt(end_time, start_time)',
                depth: 1,
                note: 'The good case: true when the visit ended after it started.',
              },
              {
                code: 'not( … )',
                note: 'Validate rules describe the BAD case, so the good condition is inverted. The submission is rejected exactly when this is true — i.e. exactly when the good case is false.',
              },
            ]}
          />
        </MockRuleCard>

        <Callout type="warning" title="Validate reads backwards on purpose">
          It is tempting to write the condition you want to be true and expect the engine to block
          when it fails. Validate does the opposite: write the condition that describes the
          problem. <Code>not(between(score, 0, 100))</Code> rejects an out-of-range score;{' '}
          <Code>between(score, 0, 100)</Code> would (incorrectly) reject every valid one.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Starting templates">
        <P>
          The rule editor offers these as ready-made starting points, so the common shapes above are
          one click rather than four nested pickers. Each produces a tree that compiles as-is; you
          then swap a field or a constant to match your form.
        </P>
        <DocTable
          columns={['Template', 'Kind', 'What it builds']}
          rows={[
            [
              'Age from date of birth',
              'Calculate',
              <span key="t1">
                <Code>yearsBetween(date_field, today())</Code>. Swap the date field to match your
                question.
              </span>,
            ],
            [
              'Add two answers together',
              'Calculate',
              'Adds two numeric questions. Replace the second operand with another field or a constant.',
            ],
            [
              'Show when an answer matches',
              'Show',
              'Reveals a question when another has a specific value. Fill in the target value.',
            ],
            [
              'Show once something is answered',
              'Show',
              'Reveals a follow-up the moment an earlier question is filled in.',
            ],
            [
              'Require a follow-up',
              'Require',
              'Makes a question mandatory once another has any answer.',
            ],
            [
              'Reject a value outside a range',
              'Validate',
              <span key="t6">
                <Code>not(between(field, 0, 100))</Code> — blocks submission when a number falls
                outside the allowed band.
              </span>,
            ],
          ]}
        />
      </DocSectionBlock>
    </DocPage>
  );
}
