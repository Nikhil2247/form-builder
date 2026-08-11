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

export const metadata: Metadata = { title: 'The builder' };

export default function BuilderPage() {
  return (
    <DocPage
      href="/docs/forms/builder"
      title="The builder"
      intro={
        <>
          Where a form is assembled. Three regions — an outline on the left, the canvas in the
          middle, panels on the right — and an autosave loop that means you never press Save.
        </>
      }
    >
      <DocSectionBlock title="The canvas">
        <P>
          The middle column is the form, in order. Click a question to select it; the selected card
          expands to show its options, help text and per-type settings. Everything is edited in
          place — there is no separate properties dialog to keep in sync with what you are looking
          at.
        </P>
        <DocList
          items={[
            <>
              <Term>Add</Term> — pick a type from the palette. The new question lands directly below
              the selected one, so you build top to bottom.
            </>,
            <>
              <Term>Reorder</Term> — drag a card by its handle. Conditional logic follows the
              question, so reordering never silently breaks a rule.
            </>,
            <>
              <Term>Duplicate</Term> — copies the question and its options with fresh ids. The copy
              is independent; editing one does not touch the other.
            </>,
            <>
              <Term>Delete</Term> — removes the question and any logic rule that referenced it. A
              rule pointing at a deleted question would otherwise hide a field forever with nothing
              on screen to explain it.
            </>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="The outline">
        <P>
          The left panel lists every question by label, grouped by page. On a long form it is the
          fastest way to jump — and the quickest way to spot that you have three questions all
          still called &ldquo;Untitled question&rdquo;.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="The panels">
        <DocList
          items={[
            <>
              <Term>Settings</Term> — the public link, access, response caps, expiry and
              notifications. See <UI>Form settings</UI>.
            </>,
            <>
              <Term>Theme</Term> — colours, typography, logo and cover image.
            </>,
            <>
              <Term>Logic</Term> — show and hide questions based on earlier answers.
            </>,
            <>
              <Term>Rules</Term> — calculations, conditional requiredness and cross-question
              validation.
            </>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Autosave, and what it does not do">
        <P>
          The draft saves a couple of seconds after you stop typing. There is no Save button and
          closing the tab loses nothing.
        </P>
        <P>
          Autosave writes the <Term>draft</Term>. It does not change what respondents see. Once a
          form is published, the builder shows <UI>Unpublished changes</UI> whenever the draft has
          moved ahead of the live version, and it stays that way until you publish again.
        </P>
        <Callout type="warning" title="Two people editing at once">
          If someone else saves the same form while you have it open, your next save is refused
          rather than silently overwriting their work, and you are asked to reload. Reloading
          discards unsaved local edits, so if you are both working on one form, agree who has it.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Question keys">
        <P>
          Each question has a stable <Term>key</Term> derived from its label — this is what rules
          and exports refer to. Renaming a question&apos;s label does not change its key once the
          key exists, precisely so that a wording fix does not break a calculation or shift a
          column in every export you have already sent to someone.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
