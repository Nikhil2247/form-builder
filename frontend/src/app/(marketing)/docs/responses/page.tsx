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

export const metadata: Metadata = { title: 'Responses' };

export default function ResponsesPage() {
  return (
    <DocPage
      href="/docs/responses"
      title="Responses"
      intro={<>Reading what came back, finding the one you need, and getting it out of the system.</>}
    >
      <DocSectionBlock title="The response list">
        <P>
          <UI>Responses</UI> lists every submission, newest first, across all versions of the form.
          Open one to see its answers laid out against the questions of the version it was filed
          against — so a response from before you reworded a question still reads correctly.
        </P>
        <P>
          An answer whose question no longer exists is still shown, marked as removed, rather than
          dropped. Silently hiding submitted data is worse than an unfamiliar label.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Response statuses">
        <DocTable
          columns={['Status', 'Meaning']}
          rows={[
            ['Submitted', 'Accepted and stored. The normal case.'],
            [
              'Flagged as spam',
              'Caught by the honeypot or CAPTCHA. Kept rather than discarded so you can check the filter is not over-eager.',
            ],
            ['Rejected', 'Failed validation at ingest and was not stored as a normal response.'],
            ['Deleted', 'Soft-deleted. Removed from the list; recoverable.'],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Exporting">
        <P>
          Export the set as <Term>CSV</Term> or <Term>Excel</Term>. One row per response, one column
          per question, using labels as headers. Multi-select answers become a delimited list;
          uploaded files become a reference.
        </P>
        <Callout type="note" title="Exports are safe to open">
          Cells that begin with a character a spreadsheet would treat as a formula are neutralised
          before export. Without that, a respondent could type something into a text box that runs
          when a colleague opens the file.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Responses inside a data app">
        <P>
          When a form is part of a data app, its responses also appear on the record they were filed
          against. The record&apos;s timeline shows every entry in order, and opening one shows that
          response in place, with previous and next to step through the rest — so reviewing
          everything collected about one school does not mean visiting each form&apos;s response
          list in turn.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Deleting">
        <P>
          Deleting a response is a soft delete. It leaves the list and the exports; it is not
          immediately destroyed. Deleting the <Term>form</Term> does not delete its responses — the
          form goes to Trash and the data stays with it, which is why restoring a form restores
          everything collected through it.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Who can see what">
        <DocTable
          columns={['Role', 'Responses']}
          rows={[
            ['Viewer', 'Read and export.'],
            ['Editor', 'Read, export and delete.'],
            ['Admin', 'Everything an editor can do.'],
          ]}
        />
        <P>
          Responses never cross organizations. Every read is scoped to the workspace you are in,
          checked on the server rather than filtered in the browser.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
