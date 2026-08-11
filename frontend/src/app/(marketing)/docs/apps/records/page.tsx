import type { Metadata } from 'next';

import {
  Callout,
  DocPage,
  DocSectionBlock,
  DocList,
  P,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Records and timeline' };

export default function RecordsPage() {
  return (
    <DocPage
      href="/docs/apps/records"
      title="Records and timeline"
      intro={
        <>
          A record is one subject and everything ever collected about it. This is the page an app
          exists to produce.
        </>
      }
    >
      <DocSectionBlock title="The records list">
        <P>
          <UI>Records</UI> lists every subject in the workspace, filterable by record type and
          searchable by name or external id. Columns show the promoted attributes you chose on the
          record type, which is why choosing them well matters — this is the view people scan.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="A record page">
        <P>Three parts, in order of how often they are needed:</P>
        <DocList
          items={[
            <>
              <Term>Identity</Term> — the display name and external id, so you can confirm you are
              looking at the right subject.
            </>,
            <>
              <Term>Attributes</Term> — the promoted answers, as a summary.
            </>,
            <>
              <Term>Timeline</Term> — every response filed against this record, newest first, with
              the form it came from, when it arrived and how many answers it holds.
            </>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Reading a response without leaving">
        <P>
          Click any timeline entry to open that response in place, laid out against its form&apos;s
          questions. Previous and next step through the record&apos;s other entries without closing
          — so reviewing a school&apos;s three submissions is three clicks, not three trips out to
          separate response lists and back.
        </P>
        <P>
          <UI>All responses</UI> in the dialog footer is there for when you do want the full list
          for that form across every record. It is the secondary action, not the default.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Deleting a record">
        <Callout type="warning" title="The responses survive">
          Deleting a record removes it from lists and searches. The responses collected against it
          are kept — months of collected data should not disappear behind one button. The
          confirmation says so, because a delete that appears to destroy everything is one nobody
          dares press even when it is the right thing to do.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Duplicates">
        <P>
          Two records for the same school happen — a name typed differently, a code missed. The
          records list is where you will spot it. Prevention is better: get the record type&apos;s
          identity right, ideally around an external code, and the duplicate check will flag matches
          to the operator during the session rather than after the fact.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
