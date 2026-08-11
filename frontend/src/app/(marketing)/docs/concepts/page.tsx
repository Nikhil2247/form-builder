import type { Metadata } from 'next';

import {
  Callout,
  DocPage,
  DocSectionBlock,
  DocTable,
  P,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Core concepts' };

export default function ConceptsPage() {
  return (
    <DocPage
      href="/docs/concepts"
      title="Core concepts"
      intro={
        <>
          Nine words that appear throughout the product and the rest of these docs. Skim the table,
          then read the three that are easy to get wrong.
        </>
      }
    >
      <DocSectionBlock title="The vocabulary">
        <DocTable
          columns={['Term', 'What it is']}
          rows={[
            [
              'Organization',
              'A workspace. Forms, responses, records and option lists all belong to exactly one, and nothing is visible across them. Also called a tenant.',
            ],
            [
              'Form',
              'One questionnaire, with its own questions, settings, theme and public link.',
            ],
            [
              'Version',
              'An immutable snapshot of a form taken at publish. Respondents fill a version; responses are bound to the one they saw.',
            ],
            [
              'Response',
              'One completed submission of one version of one form.',
            ],
            [
              'Question',
              'A single field. Has a type, a label, validation, and a stable id that answers are keyed by.',
            ],
            [
              'Option list',
              'A managed set of dropdown options — states, districts, schools — reusable across every form.',
            ],
            [
              'Record type',
              'The kind of subject a data app collects about: a school, a patient, a household.',
            ],
            [
              'Record',
              'One instance of a record type, with a history of every response filed against it.',
            ],
            [
              'Data app',
              'Several forms bound to a record type and filled as one guided session.',
            ],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Draft and published are different things">
        <P>
          A form has a <Term>draft</Term> — what you see in the builder — and zero or more{' '}
          <Term>published versions</Term>. Editing changes the draft. Publishing copies the draft
          into a new numbered version and points the public link at it.
        </P>
        <P>
          This is why a question you deleted this morning still appears on responses from last
          week: those responses were filed against a version that had it. Nothing rewrites history
          when you edit, which is what makes the data trustworthy months later.
        </P>
        <Callout type="note" title="Which version a respondent gets">
          Whoever opens the link gets the version the form currently points at. Someone who opened
          the form before you republished finishes the version they started, and their response is
          recorded against it.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="A response is not a record">
        <P>
          A <Term>response</Term> is an event: someone filled a form at a moment in time. A{' '}
          <Term>record</Term> is a subject that persists: a school, a patient, a supplier. One
          record accumulates many responses over months or years.
        </P>
        <P>
          If you only ever need &ldquo;who said what&rdquo;, forms and responses are enough. If you
          need &ldquo;everything we know about this school, in order&rdquo;, you want a record type
          and a data app. The record page then shows the whole timeline, and you can open any
          response in it without leaving the page.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Values and labels">
        <P>
          Every choice option has a <Term>label</Term> — what a respondent reads — and a{' '}
          <Term>value</Term> — what gets stored. The distinction matters when you export: the value
          is what appears in the data, and it must stay stable. Renaming a district&apos;s label is
          harmless. Changing its value orphans every historical answer that referenced it.
        </P>
        <P>
          This is also why retiring an option from an option list deactivates it rather than
          deleting it. It stops being offered on new responses; old ones still resolve to a
          readable label instead of a bare code.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Two role axes, not one">
        <P>
          Your <Term>organization role</Term> (<UI>Admin</UI>, <UI>Editor</UI>, <UI>Viewer</UI>)
          governs what you can do inside a workspace. Your <Term>system role</Term> (
          <UI>Super admin</UI> or ordinary user) governs platform administration.
        </P>
        <P>
          These are independent. A super admin is not automatically an admin of any organization,
          and an organization admin has no platform access. See <Term>Team and roles</Term>.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
