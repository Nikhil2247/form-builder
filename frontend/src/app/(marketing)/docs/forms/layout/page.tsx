import type { Metadata } from 'next';

import {
  Callout,
  Compare,
  DocPage,
  DocSectionBlock,
  DocTable,
  P,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Pages and layout' };

export default function LayoutPage() {
  return (
    <DocPage
      href="/docs/forms/layout"
      title="Pages and layout"
      intro={
        <>
          Two independent decisions: how the form is broken into pages, and how fields are arranged
          on each one. Both are in <UI>Settings</UI>, and neither changes the data you collect.
        </>
      }
    >
      <DocSectionBlock title="Pages">
        <P>
          A form starts as one page. Add more when the questionnaire is long enough that a single
          scroll is discouraging, or when there is a natural break — &ldquo;about you&rdquo;, then
          &ldquo;about the visit&rdquo;.
        </P>
        <P>
          Each page can carry its own title and description, shown above its questions. Respondents
          move with Next and Back, and a progress indicator shows where they are. Answers are kept
          when moving between pages, and validation for a page runs when leaving it, so nobody
          reaches the end and is sent back four screens.
        </P>
        <Callout type="note" title="Deleting a page">
          Questions on a deleted page move to page one rather than being deleted with it. Losing a
          page should not silently lose the work that was on it.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Layout modes">
        <P>
          The layout mode decides how each page&apos;s fields are arranged. It is a presentation
          choice only — the same questions, the same answers, the same export.
        </P>
        <DocTable
          columns={['Mode', 'What it does', 'Best for']}
          rows={[
            [
              'Document',
              'Every field stacked one per row, the whole page scrollable.',
              'The default, and right for most forms. Also the most comfortable on a phone.',
            ],
            [
              'Conversational',
              'One question at a time, advancing as each is answered.',
              'Long forms where the length itself puts people off, and public surveys on mobile.',
            ],
            [
              'Grid',
              'Narrow fields pair up two per row on wide screens.',
              'Desk-based data entry, where fitting more on screen means fewer scrolls per record.',
            ],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Grid layout and field width">
        <P>
          In grid layout each question has a <Term>width</Term>, set on the question card:
        </P>
        <DocTable
          columns={['Width', 'Behaviour']}
          rows={[
            [
              'Auto',
              'The default. Pairs up with the next field, unless the control needs the whole row.',
            ],
            ['Half', 'Always takes half the row.'],
            ['Full', 'Always takes the whole row — useful to force a break between groups.'],
          ]}
        />
        <P>
          Long answer, matrix, file upload, signature, repeating section and section headers always
          take a full row whatever you choose. A matrix at half width scrolls sideways, and a
          paragraph box at half width invites one-line answers to a question that wanted more.
        </P>
        <Callout type="note" title="Grid is a desktop distinction">
          Below a tablet breakpoint every layout collapses to a single column. A grid form on a
          phone is a stacked form, so choosing grid never makes the mobile experience worse.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Choosing between them">
        <Compare
          doTitle="Reach for grid when"
          dontTitle="Stay with document when"
          doItems={[
            <>Operators enter many records a day at a desk.</>,
            <>Most fields are short — codes, dates, numbers, short names.</>,
            <>Fitting a whole section on one screen saves real scrolling.</>,
          ]}
          dontItems={[
            <>The form is mostly long-answer questions, which take a full row anyway.</>,
            <>Most respondents are on phones, where it makes no difference.</>,
            <>The questions build on each other and reading order matters more than density.</>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Layout in data apps">
        <P>
          A data app makes the same choice in <UI>App settings → Design → Layout</UI>, with a third
          option: <UI>Stacked</UI> and <UI>Two column</UI> impose one arrangement on every step,
          while <UI>Follow each form</UI> lets each step keep the layout its form was built with.
        </P>
        <P>
          Imposing one arrangement is the default because a session that changes column count
          between step two and step three reads as a rendering fault rather than a design. The cost
          is that it overrides the widths above: a two-column form with paired fields renders as a
          stacked list inside a <UI>Stacked</UI> app, from the same definition that pairs correctly
          on its own link. Choose <UI>Follow each form</UI> to keep them.
        </P>
        <P>
          Conversational is never used inside an app — it paces one question at a time, and an app
          already paces the respondent with its own steps. Such a form is shown stacked instead.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
