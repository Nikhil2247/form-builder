import type { Metadata } from 'next';

import {
  Callout,
  Compare,
  DocPage,
  DocSectionBlock,
  DocList,
  P,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'What a data app is' };

export default function AppsPage() {
  return (
    <DocPage
      href="/docs/apps"
      title="What a data app is"
      intro={
        <>
          Several forms, bound to the same subject, filled as one guided session. Where a form
          collects an event, an app builds a history.
        </>
      }
    >
      <Callout type="note" title="Data apps are a feature flag">
        If you do not see <UI>Data entry</UI> in the workspace switcher, apps are not enabled for
        your organization. A super admin turns them on per organization from{' '}
        <UI>Platform → Features</UI>.
      </Callout>

      <DocSectionBlock title="The problem it solves">
        <P>
          A monitoring visit records the school, the training delivered, and what was observed in
          three separate blocks. As three forms, someone fills them one after another and nothing
          ties them together — you end up with three response lists and a spreadsheet exercise to
          rejoin them.
        </P>
        <P>
          As an app, they are three <Term>steps</Term> of one session, all filed against that
          school&apos;s <Term>record</Term>. The record then shows the whole history in order, and
          next quarter&apos;s visit adds to it rather than starting again.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Form or app?">
        <Compare
          doTitle="Build an app when"
          dontTitle="A plain form is enough when"
          doItems={[
            <>The same subject is measured repeatedly over time.</>,
            <>Several forms are always filled together.</>,
            <>You need &ldquo;everything we know about this school&rdquo; on one page.</>,
            <>A later form needs an answer given on an earlier one for the same subject.</>,
          ]}
          dontItems={[
            <>Each submission stands alone — a survey, a contact form, a registration.</>,
            <>There is no persistent subject, only respondents.</>,
            <>One form covers it.</>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="The pieces">
        <DocList
          items={[
            <>
              A <Term>record type</Term> — the kind of thing being measured, and what identifies one.
            </>,
            <>
              <Term>Steps</Term> — the forms, in order, each with a cardinality and an optional
              condition.
            </>,
            <>
              A <Term>public link</Term> of its own, its own theme, and its own access rules.
            </>,
            <>
              <Term>Periods</Term> — optional reporting windows, so an app can be open only during a
              quarter.
            </>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="What a session looks like">
        <P>
          A respondent opens the app&apos;s link, identifies or creates the record, then works
          through the steps on one page — no navigating between forms. Progress can be saved and
          resumed if drafts are allowed. On submit, every step becomes a response against that
          record, all bound to the same session.
        </P>
        <P>
          Validation runs across the whole session, so problems in step one and step three are
          reported together rather than one screen at a time.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Access defaults are stricter">
        <P>
          An app requires sign-in by default, where a form does not. An app writes to a registry,
          which is a heavier act than answering a survey, and the safe default for something that
          creates records is closed. Change it in <UI>App settings → Access</UI> if the app is
          genuinely public.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
