import type { Metadata } from 'next';

import {
  Callout,
  Code,
  DocPage,
  DocSectionBlock,
  DocTable,
  P,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Rules and calculations' };

export default function RulesPage() {
  return (
    <DocPage
      href="/docs/forms/rules"
      title="Rules and calculations"
      intro={
        <>
          Compute a value from other answers, require a question only in some circumstances, or
          reject a combination of answers that cannot be right. Rules are authored visually and
          compiled when the form is published.
        </>
      }
    >
      <DocSectionBlock title="The four kinds">
        <DocTable
          columns={['Rule', 'What it does']}
          rows={[
            [
              'Calculate',
              'Sets a question’s value from an expression. The field becomes read-only — the respondent sees the result but cannot type over it.',
            ],
            [
              'Visibility',
              'Shows or hides a question. Same effect as conditional logic, with the full expression language available.',
            ],
            [
              'Requiredness',
              'Makes a question required only when a condition holds — "if you answered yes, tell us why".',
            ],
            [
              'Validation',
              'Rejects the response with a message you write, when a condition across several answers is violated.',
            ],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Writing an expression">
        <P>
          Expressions are built in the rule editor rather than typed as code. They can reference
          any question earlier in the form by its key, combine values with arithmetic and
          comparison, and nest conditions with and/or/not.
        </P>
        <P>
          The editor only offers questions that are actually available at that point, so an
          expression cannot reference something the respondent has not reached. Referencing a
          question you later delete is caught when you publish, with the offending rule named —
          rather than silently dropped, which would delete work without telling anyone.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Lookups: auto-filling from an option list">
        <P>
          A <Code>lookup()</Code> reads a metadata column off the option someone picked. If your
          school list carries a UDISE code against each school, a calculate rule can fill a
          read-only &ldquo;UDISE code&rdquo; field the moment the school is chosen — no second
          dropdown, no transcription error.
        </P>
        <P>
          This is the main reason to put extra columns on an option list when you upload it. See{' '}
          <UI>Cascading and lookups</UI>.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Calculated values are recomputed on the server">
        <Callout type="warning" title="The browser's answer is never trusted">
          Every calculated value is recomputed when the response is submitted, and whatever the
          browser sent for that field is discarded. Someone posting a made-up value to a calculated
          eligibility field changes nothing. Client-side evaluation exists so the respondent sees
          the number update as they type — it is a convenience, not the source of truth.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Cycles">
        <P>
          A rule set where A depends on B and B depends on A cannot be evaluated, and is rejected
          when you publish with the questions involved named. This is checked across the whole set
          rather than rule by rule, which is why the rule panel edits all of them together.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Cross-form references">
        <P>
          A form bound to a <Term>record type</Term> can reference an answer given on another form{' '}
          <em>for the same record</em> — reading the registration form&apos;s district on a later
          visit form, for instance.
        </P>
        <P>
          This is only available on forms that have a record type. Without one there is no subject
          to look the value up against, so the reference has nothing to resolve and the publish
          step rejects it.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
