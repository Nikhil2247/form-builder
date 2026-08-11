import type { Metadata } from 'next';

import {
  Callout,
  Code,
  DocPage,
  DocSectionBlock,
  P,
  Steps,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Quickstart' };

export default function QuickstartPage() {
  return (
    <DocPage
      href="/docs/quickstart"
      title="Quickstart"
      intro={
        <>
          Build a form, publish it, share the link, and read the first response. Ten minutes, no
          configuration beyond an account and an organization.
        </>
      }
    >
      <DocSectionBlock title="1. Create the form">
        <Steps
          items={[
            <>
              From the dashboard, open <UI>Forms</UI> and choose <UI>New form</UI>. You land in the
              builder on an empty canvas — not a template, so nothing has to be deleted first.
            </>,
            <>
              Give it a title in place of &ldquo;Untitled form&rdquo;. This is what respondents see
              at the top of the page and what the form is listed under.
            </>,
            <>
              Add questions from the field palette. Each one lands below the currently selected
              question, so you can build in reading order rather than dragging afterwards.
            </>,
            <>
              Set the ones that matter to <UI>Required</UI>. A response missing a required answer
              is rejected at submit with the message pointing at that specific field.
            </>,
          ]}
        />
        <Callout type="note" title="Your work is saved as you go">
          The builder autosaves every couple of seconds. There is no Save button, and closing the
          tab does not lose anything. What autosave does <em>not</em> do is change what respondents
          see — that is publishing, below.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="2. Preview it">
        <P>
          Open <UI>Preview</UI> to fill the form exactly as a respondent would, including
          conditional logic and calculated fields. Previewing does not create a response and does
          not count towards analytics.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="3. Publish">
        <P>
          Press <UI>Publish</UI>. This snapshots the current draft as a numbered version and makes
          it live at the form&apos;s public link. Until you publish, the link shows nothing —
          a draft form is not reachable by respondents.
        </P>
        <P>
          The link looks like <Code>https://your-domain/f/your-form</Code>. You can change the last
          part in <UI>Settings → Public link</UI> before you share it anywhere.
        </P>
        <Callout type="warning" title="Editing after publishing">
          Later edits go to the draft, not to the live form. The builder shows{' '}
          <UI>Unpublished changes</UI> when the two differ; press Publish again to push them. This
          is deliberate — it means you can rework a live form without respondents seeing a
          half-finished question.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="4. Share it">
        <P>
          Copy the public link and send it however you normally would. If the form should only
          accept responses from people signed in to your organization, turn on{' '}
          <UI>Require sign-in</UI> in settings before sharing — it is enforced when the response is
          submitted, not just hidden in the UI.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="5. Read what comes back">
        <P>
          Responses appear under <UI>Responses</UI>, newest first. Open one to see the answers laid
          out against the form&apos;s questions, and export the set as CSV or Excel when you need it
          elsewhere.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="What to read next">
        <P>
          <Term>Core concepts</Term> explains versions, records and option lists, which is most of
          what is left. If your form has a question whose options are a long list that other forms
          also need — districts, schools, departments — read <Term>Option lists</Term> before
          typing them in by hand.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
