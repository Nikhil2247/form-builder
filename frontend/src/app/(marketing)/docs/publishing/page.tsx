import type { Metadata } from 'next';

import {
  Callout,
  DocList,
  DocPage,
  DocSectionBlock,
  P,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Publishing and sharing' };

export default function PublishingPage() {
  return (
    <DocPage
      href="/docs/publishing"
      title="Publishing and sharing"
      intro={
        <>
          Publishing takes a snapshot of the draft and makes it the live form. Understanding what a
          version is makes the rest of the product make sense.
        </>
      }
    >
      <DocSectionBlock title="What publishing does">
        <DocList
          items={[
            <>Copies the current draft — questions, pages, logic, rules and theme — into a new numbered version.</>,
            <>Compiles the rule set, reporting any rule that cannot be resolved rather than dropping it.</>,
            <>Points the public link at the new version.</>,
            <>Leaves every earlier version intact, along with the responses filed against them.</>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Draft and live diverge, on purpose">
        <P>
          After the first publish, editing changes the draft only. The builder shows{' '}
          <UI>Unpublished changes</UI> while the two differ.
        </P>
        <P>
          This is what lets you rework a live form over an afternoon without respondents meeting a
          half-finished question. Nothing you type reaches them until you publish again.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Republishing while people are filling it in">
        <Callout type="note" title="Nobody loses their place">
          Someone who opened the form before you republished finishes the version they started, and
          their response is recorded against it. Anyone arriving after gets the new one. There is no
          moment where a respondent is filling one structure and submitting against another.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Changes that need care">
        <P>
          Adding a question, rewording a label, adjusting a theme: safe at any time. Two changes
          deserve a pause on a form that already has responses.
        </P>
        <P>
          <Term>Deleting a question.</Term> Past responses keep their answers and still display
          them, but the question disappears from new responses and from the export&apos;s columns.
          If you only want to stop asking it, consider hiding it with a rule instead.
        </P>
        <P>
          <Term>Changing an option&apos;s value.</Term> The label is display; the value is stored.
          Changing a value means old responses hold a code the new form no longer recognises.
          Change labels freely; leave values alone.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Sharing">
        <P>
          Copy the public link from the builder or the form&apos;s page. There is nothing else to
          configure — the link works for anyone unless you have turned on sign-in or a password in{' '}
          <UI>Settings</UI>.
        </P>
        <P>
          To take a form down, close it or archive it rather than deleting it. Both tell visitors
          it is no longer accepting responses, which is more useful than a page that looks like a
          broken link.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
