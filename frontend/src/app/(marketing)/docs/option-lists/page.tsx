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

export const metadata: Metadata = { title: 'Option lists' };

export default function OptionListsPage() {
  return (
    <DocPage
      href="/docs/option-lists"
      title="Option lists"
      intro={
        <>
          A named set of dropdown options, managed in one place and reusable across every form.
          Upload your districts once; correct a spelling once; every question bound to the list
          follows.
        </>
      }
    >
      <DocSectionBlock title="When you need one">
        <P>
          Type options directly into a question when there are a handful and only that form needs
          them — &ldquo;Yes / No / Not applicable&rdquo;. Use an option list when the set is long,
          shared between forms, or likely to change.
        </P>
        <P>
          The break-even point arrives sooner than people expect. Three forms each carrying their
          own copy of thirty districts is three places to fix when one is renamed, and no way to
          tell whether all three were fixed.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Where they live">
        <P>
          Organization admins manage their own lists at <UI>Organization → Option lists</UI>.
          Alongside them you will see <Term>platform lists</Term> marked with a globe — reference
          data curated centrally and available to every organization. India&apos;s states and
          districts ship that way.
        </P>
        <P>
          Platform lists are read-only from an organization. If you need a corrected or trimmed
          version, create your own list with the same id — yours takes precedence for your
          organization and nobody else is affected.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Creating a list">
        <Steps
          items={[
            <>
              Choose <UI>New list</UI> and give it a name. The <Term>id</Term> is derived from the
              name and is how questions refer to the list.
            </>,
            <>
              If it cascades from another list — districts under states — pick that list under{' '}
              <UI>Cascades from</UI>. See <UI>Cascading and lookups</UI>.
            </>,
            <>
              Choose <UI>Upload CSV</UI> and give it your file.
            </>,
          ]}
        />
        <Callout type="warning" title="The id cannot change later">
          Questions bind to a list by its id. Renaming it would empty every dropdown that uses the
          list, so the field is locked once the list exists. The display name can be changed freely.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Uploading a CSV">
        <P>
          Start with <UI>Download template</UI> in the upload dialog. It gives you a file with this
          list&apos;s exact columns — and, for a cascading list, real parent values from the list
          above, so your sample rows are ones that will actually import.
        </P>
        <P>Then upload it. The importer:</P>
        <DocTable
          columns={['Handles', 'Detail']}
          rows={[
            ['Delimiters', 'Comma, semicolon, tab or pipe, detected from the header row.'],
            [
              'Excel exports',
              'The byte-order mark Excel writes is stripped, so your first column name still matches.',
            ],
            [
              'Quoting',
              'Commas, quotes and line breaks inside a quoted field are read correctly — a district called "Kadapa, YSR" stays one value.',
            ],
            ['Column order', 'Irrelevant. You map columns to fields after upload.'],
            ['Size', 'Up to 20,000 rows per upload. Larger files are uploaded in parts.'],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Mapping the columns">
        <P>After the file is read you choose what each column means:</P>
        <DocTable
          columns={['Field', 'Required', 'What it is']}
          rows={[
            [
              'Value',
              'Yes',
              'The code stored in the answer. Must be unique within the list and must stay stable across re-imports.',
            ],
            [
              'Label',
              'No',
              'What respondents read. Falls back to the value when not mapped.',
            ],
            [
              'Parent value',
              'On cascading lists',
              'The item in the parent list this row sits under, named by that list’s value.',
            ],
            [
              'Extra columns',
              'No',
              'Carried alongside each item and readable by a rule for auto-fill — a UDISE code, a pincode, a category.',
            ],
          ]}
        />
        <P>
          The preview shows the first rows exactly as they will be stored, with empty values
          flagged before you commit.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Replace or add">
        <DocTable
          columns={['Mode', 'What happens']}
          rows={[
            [
              'Replace the list',
              'Rows in the file are added or updated. Items not in the file stop being offered.',
            ],
            [
              'Add and update',
              'Rows in the file are added or updated. Everything already in the list is left alone. Use this to upload a large dictionary in parts.',
            ],
          ]}
        />
        <Callout type="note" title="Retired is not deleted">
          An item that Replace drops is deactivated, not removed. It stops appearing in dropdowns,
          but every past response that referenced it still shows a readable label instead of a bare
          code. Turn on <UI>Show retired</UI> in the item browser to see them.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Binding a question to a list">
        <P>
          In the builder, select a Choose one, Choose all that apply, or Select an option question
          and switch its options source from typed options to a list. Pick the list; the question
          now draws from it.
        </P>
        <P>
          The binding is checked when you save. Pointing a question at a list that does not exist is
          refused with the list named, rather than producing a dropdown that renders permanently
          empty with nothing to explain it.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Exporting">
        <P>
          <UI>Export</UI> downloads the list in the same column layout the importer accepts, so the
          round trip works: export, correct in a spreadsheet, re-import with{' '}
          <Code>Replace the list</Code>.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
