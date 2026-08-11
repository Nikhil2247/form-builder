import type { Metadata } from 'next';

import {
  Callout,
  Code,
  DocPage,
  DocSectionBlock,
  DocTable,
  P,
  Steps,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Cascading and lookups' };

export default function CascadingPage() {
  return (
    <DocPage
      href="/docs/option-lists/cascading"
      title="Cascading and lookups"
      intro={
        <>
          Two things a hand-typed option set cannot do: filter one dropdown by another, and fill a
          field automatically from the option someone picked.
        </>
      }
    >
      <DocSectionBlock title="Cascading dropdowns">
        <P>
          Choosing a state should leave only that state&apos;s districts on offer. That is a{' '}
          <Term>cascade</Term>, and it is a property of the lists rather than of any one form —
          build it once and every form that uses both lists gets it.
        </P>
        <Steps
          items={[
            <>
              Create the parent list first — <Code>in-states</Code>, say — and upload its items.
            </>,
            <>
              Create the child list and set <UI>Cascades from</UI> to the parent.
            </>,
            <>
              Upload the child&apos;s items with a <Term>parent value</Term> column. Each row names
              the parent item it sits under, using the parent&apos;s <em>value</em> — not its label.
            </>,
            <>
              In the builder, bind one question to the parent list and another to the child. The
              child question asks which question supplies its parent answer.
            </>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="What a respondent sees">
        <DocTable
          columns={['State', 'Behaviour']}
          rows={[
            [
              'Parent not answered',
              'The child says "Choose {the parent question} first" rather than rendering an empty dropdown. An empty dropdown is the single most confusing thing here — there is no way to tell loading from broken from waiting.',
            ],
            [
              'Parent answered',
              'The child loads only the items under that parent.',
            ],
            [
              'Parent changed',
              'The child reloads and its own answer is cleared. A block left selected under a newly chosen district would be a combination the server rejects at submit.',
            ],
            [
              'Long child list',
              'Above about thirty options the control becomes searchable and filters on the server as the respondent types, so a school registry never has to be sent to the browser.',
            ],
          ]}
        />
        <Callout type="note" title="Cascade consistency is checked at submit">
          The server verifies that the block really does sit under the district that was submitted
          with it. A mismatched pair is rejected, so the stored data is internally consistent
          whatever the browser did.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Depth">
        <P>
          Cascades chain: state → district → block → school. Each list names one parent, which is
          exactly what a dependent dropdown needs. A list cannot be its own ancestor — a ring would
          make the cascade query loop, so it is refused when you set the parent.
        </P>
        <P>
          A list that others cascade from cannot be deleted while they do. Detach the children
          first; otherwise every one of them would become unreachable and every question bound to
          them silently empty.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Lookups: auto-filling from a chosen option">
        <P>
          Extra columns uploaded alongside a list stay attached to each item, and a{' '}
          <Term>calculate</Term> rule can read them with <Code>lookup()</Code>.
        </P>
        <P>
          The usual case: your school list carries a UDISE code. Add a read-only &ldquo;UDISE
          code&rdquo; question and a calculate rule that looks it up from the school question. The
          moment a school is chosen the code appears. No second dropdown, no transcription error,
          and no way for the two to disagree.
        </P>
        <P>
          Anything scalar works — a pincode, a category, a designation, a contact number. Declare
          the columns on the list so the rule editor can offer them by name, and map them during
          upload.
        </P>
        <Callout type="warning" title="Lookups are resolved server-side too">
          Like every calculated value, a looked-up field is recomputed when the response is
          submitted and the browser&apos;s version is discarded. A respondent cannot type over it, and
          posting a different value directly changes nothing.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Designing values that last">
        <P>
          A value is a join key. Once responses reference it, changing it orphans them. Two rules
          keep you out of trouble:
        </P>
        <P>
          Make values <Term>stable</Term> — derive them from something that does not change, not
          from a row number that shifts when the file is re-sorted.
        </P>
        <P>
          Make them <Term>unique across the whole list</Term>, not just within a parent. Two states
          both have a Bilaspur, so a district value of <Code>bilaspur</Code> collides;{' '}
          <Code>HP-bilaspur</Code> and <Code>CG-bilaspur</Code> do not.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
