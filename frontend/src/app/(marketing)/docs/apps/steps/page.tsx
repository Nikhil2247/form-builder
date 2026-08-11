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

export const metadata: Metadata = { title: 'Steps' };

export default function StepsPage() {
  return (
    <DocPage
      href="/docs/apps/steps"
      title="Steps"
      intro={
        <>
          A step is one form, plus how many times it is filled and whether it applies at all. This
          is what turns a list of forms into a programme.
        </>
      }
    >
      <DocSectionBlock title="Adding steps">
        <P>
          In the app builder, add each form as a step and drag them into the order a respondent
          should work through. The order is the session; step two is not reachable as a separate
          page and does not need its own link.
        </P>
        <P>
          Give each step a title and an optional icon. The title is what appears as the section
          heading during the session, so it can be friendlier than the form&apos;s own name.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Cardinality">
        <DocTable
          columns={['Mode', 'Behaviour']}
          rows={[
            [
              'Single',
              'Filled exactly once per session. The respondent block of a monitoring visit.',
            ],
            [
              'Repeatable',
              'Filled any number of times, with Add and Remove controls. Every school visited, every training delivered, every child in a household.',
            ],
          ]}
        />
        <P>
          A repeatable step takes a minimum and a maximum. A minimum of one means the session cannot
          be submitted without at least one entry; a maximum caps it. A mandatory repeatable step
          shows one empty entry to begin with — asking someone to press <UI>Add</UI> before they can
          start is a step people miss.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Optional and conditional steps">
        <P>
          Mark a step <Term>optional</Term> and it can be left empty. Give it a{' '}
          <Term>condition</Term> and it appears only when an earlier answer calls for it — a
          follow-up block that only applies when the first answer was &ldquo;yes&rdquo;.
        </P>
        <P>
          A step that is hidden by its condition is not validated and not submitted. As with
          conditional logic on a form, nobody is blocked by something they were never shown.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Validation across the session">
        <Callout type="note" title="Problems are reported together">
          When a session is submitted, every step is validated and all the problems come back at
          once, each attached to the field it belongs to. A respondent told &ldquo;the report cannot
          be submitted&rdquo; needs to know which box, not just which step — and they should not
          have to fix one, resubmit, and discover another.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Drafts and resuming">
        <P>
          With <UI>Allow drafts</UI> on, a session can be left and picked up later, which matters
          when a visit is interrupted or the connection is poor. With it off, a session must be
          completed in one sitting.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Periods">
        <P>
          Periods are reporting windows — a quarter, a term, a campaign. When an app has periods
          configured and none is currently open, it tells visitors it is between cycles rather than
          accepting data against no period at all. Sessions are stamped with the period they were
          collected in, which is what makes quarter-on-quarter comparison possible later.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Layout">
        <P>
          The <UI>Design → Layout</UI> setting applies to every step at once: stacked, or two-column
          on wide screens. It is app-wide deliberately — changing column count between step two and
          step three reads as a fault rather than a design. Both collapse to a single column on
          phones.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
