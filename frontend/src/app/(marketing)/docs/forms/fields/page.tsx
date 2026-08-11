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

export const metadata: Metadata = { title: 'Field types' };

export default function FieldsPage() {
  return (
    <DocPage
      href="/docs/forms/fields"
      title="Field types"
      intro={
        <>
          Every question type, what it stores, and the validation it accepts. Choosing the closest
          type is worth a moment — it decides the keyboard a phone shows, what the export column
          contains, and whether a rule can do arithmetic on the answer.
        </>
      }
    >
      <DocSectionBlock title="Text">
        <DocTable
          columns={['Type', 'Stores', 'Use it for']}
          rows={[
            [
              'Short answer',
              'A single line of text',
              'Names, reference numbers, anything under a sentence.',
            ],
            [
              'Long answer',
              'Multi-line text',
              'Comments and descriptions. Always takes a full row in grid layout.',
            ],
            [
              'Email',
              'A validated address',
              'Contact details. Rejected at submit if it is not a plausible address.',
            ],
            [
              'Phone',
              'A phone number as typed',
              'Contact details. Shows a numeric keypad on mobile.',
            ],
            ['Website', 'A URL', 'Links. Must include a scheme to pass validation.'],
          ]}
        />
        <P>
          Text fields accept a minimum and maximum length, and a regular-expression pattern for
          formats you need to enforce exactly — an employee code, a vehicle registration.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Numbers and scales">
        <DocTable
          columns={['Type', 'Stores', 'Use it for']}
          rows={[
            [
              'Number',
              'A number',
              'Quantities and amounts. Accepts a minimum and maximum. Rules can do arithmetic on it.',
            ],
            [
              'Slider',
              'A number within a range',
              'A bounded value where the range itself is the point — satisfaction out of ten.',
            ],
            [
              'Star rating',
              'An integer',
              'Quick sentiment. Faster to answer than a number box.',
            ],
            [
              'NPS',
              'An integer 0–10',
              'Net promoter score, with the standard eleven-point presentation.',
            ],
          ]}
        />
        <Callout type="tip" title="Store numbers as numbers">
          A quantity captured as short answer cannot be summed, averaged, or compared by a rule,
          and it will arrive in your export as text. If you might ever calculate with it, use
          Number.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Choices">
        <DocTable
          columns={['Type', 'Stores', 'Use it for']}
          rows={[
            [
              'Choose one',
              'One value',
              'Radio buttons. Best under about seven options, where seeing them all at once helps.',
            ],
            [
              'Choose all that apply',
              'An array of values',
              'Checkboxes. Exports as a delimited list.',
            ],
            [
              'Select an option',
              'One value',
              'A dropdown. Better than radios once the list is long, and the only sensible choice above about thirty.',
            ],
          ]}
        />
        <P>
          Any of the three can take its options from an <Term>option list</Term> instead of a
          hand-typed set. That is what you want for districts, schools or anything else more than
          one form needs — see <UI>Option lists</UI>.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Dates, files and signatures">
        <DocTable
          columns={['Type', 'Stores', 'Use it for']}
          rows={[
            [
              'Date',
              'A calendar date',
              'Dates of birth, visit dates, deadlines. Accepts an allowed range.',
            ],
            [
              'File upload',
              'A reference to an uploaded file',
              'Evidence and attachments. Accepts allowed file types and a size cap.',
            ],
            [
              'Signature',
              'A drawn signature image',
              'Acknowledgements and sign-off. Always full width.',
            ],
          ]}
        />
        <Callout type="note" title="Files do not pass through the form">
          Uploads go straight to object storage and the response stores a reference. That is why a
          large attachment does not slow the submission down, and why a file reference is checked
          against the form it was uploaded for before the response is accepted.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Structure">
        <DocTable
          columns={['Type', 'Stores', 'Use it for']}
          rows={[
            [
              'Section header',
              'Nothing',
              'A heading and optional description between questions. Not counted in question numbering.',
            ],
            [
              'Matrix',
              'A value per row',
              'The same scale asked about several items. Always full width — a matrix at half width scrolls sideways.',
            ],
            [
              'Repeating section',
              'An array of answer sets',
              'A block asked an unknown number of times: every child in a household, every item on a claim.',
            ],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Required, and what it means">
        <P>
          Marking a question <UI>Required</UI> means a response cannot be submitted without it. The
          check runs on the server, so it holds regardless of what the browser did.
        </P>
        <P>
          A required question that is <Term>hidden</Term> by conditional logic is not enforced —
          someone cannot be blocked by a field they were never shown. If you need
          &ldquo;required only when…&rdquo;, that is a rule rather than a checkbox; see{' '}
          <Code>Rules and calculations</Code>.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
