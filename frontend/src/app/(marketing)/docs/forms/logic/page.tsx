import type { Metadata } from 'next';

import {
  Callout,
  DocList,
  DocPage,
  DocSectionBlock,
  P,
  Steps,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Conditional logic' };

export default function LogicPage() {
  return (
    <DocPage
      href="/docs/forms/logic"
      title="Conditional logic"
      intro={
        <>
          Show or hide a question based on what someone has already answered. This is the simplest
          of the two conditional systems; for calculations and conditional requiredness, see{' '}
          <UI>Rules and calculations</UI>.
        </>
      }
    >
      <DocSectionBlock title="Adding a rule">
        <Steps
          items={[
            <>
              Open the <UI>Logic</UI> panel in the builder.
            </>,
            <>
              Choose a <Term>trigger</Term> question — the one whose answer is watched.
            </>,
            <>
              Choose the condition: equals, does not equal, contains, is answered, is greater than,
              and so on. Which operators are offered depends on the trigger&apos;s type.
            </>,
            <>
              Choose the <Term>target</Term> question and whether to show or hide it.
            </>,
          ]}
        />
        <P>
          Rules evaluate live as the respondent types. A hidden question disappears immediately
          rather than at the page boundary, so the form never briefly asks something irrelevant.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="What hiding actually does">
        <DocList
          items={[
            <>The question is not rendered, and its answer is not collected.</>,
            <>
              If it was marked required, that is <Term>not</Term> enforced. Nobody can be blocked by
              a field they were never shown.
            </>,
            <>
              An answer given before the question was hidden is discarded on submit, so a stale
              answer cannot survive a change of mind.
            </>,
            <>
              The same evaluation runs on the server when the response is submitted. Logic is not
              something the browser can be talked out of.
            </>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Ordering">
        <P>
          A trigger must come before its target. A rule that reads a question further down the form
          can never fire, because the respondent has not reached it yet — the builder will let you
          create one but it will do nothing on the live form. If you reorder questions and a rule
          stops making sense, this is usually why.
        </P>
        <Callout type="note" title="Deleting a question">
          Deleting a question also deletes every logic rule that referenced it, as trigger or as
          target. A rule pointing at a question that no longer exists would evaluate a condition
          that can never be true and hide its target forever, with nothing on screen to explain it.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Logic or rules?">
        <P>
          Use <Term>logic</Term> when the answer is &ldquo;should this question be on screen?&rdquo;
          It is quicker to author and easier for someone else to read later.
        </P>
        <P>
          Use <Term>rules</Term> when you need a value computed, a question required only in some
          circumstances, or a check that spans several answers — &ldquo;the end date must be after
          the start date&rdquo;. Rules can also hide questions, so a form that already has a rule
          set is often clearer keeping all its conditions in one place.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
