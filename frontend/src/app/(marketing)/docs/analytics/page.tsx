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

export const metadata: Metadata = { title: 'Analytics' };

export default function AnalyticsPage() {
  return (
    <DocPage
      href="/docs/analytics"
      title="Analytics"
      intro={
        <>
          How many people saw the form, how many started it, how many finished, and where the rest
          stopped.
        </>
      }
    >
      <DocSectionBlock title="The measures">
        <DocTable
          columns={['Measure', 'Counted when']}
          rows={[
            ['Views', 'The public form page loads.'],
            ['Starts', 'Someone answers their first question. A view that never becomes a start is someone who looked and left.'],
            ['Responses', 'A submission is accepted.'],
            ['Completion rate', 'Responses divided by starts.'],
            [
              'Median completion time',
              'From first answer to submit. The median rather than the mean, so one person who left a tab open overnight does not distort it.',
            ],
          ]}
        />
        <Callout type="note" title="Previews are not counted">
          Filling your own form from the builder&apos;s preview creates no view, no start and no
          response. Testing does not pollute the numbers.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Reading drop-off">
        <P>
          The gap between <Term>views</Term> and <Term>starts</Term> is about the form&apos;s first
          impression — its length, its opening question, whether it demands sign-in before
          explaining why.
        </P>
        <P>
          The gap between <Term>starts</Term> and <Term>responses</Term> is about the form itself.
          On a multi-page form, look at which page people stop on: a page that loses a
          disproportionate share is usually asking for something people do not have to hand, or
          asking too much at once.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Where to find it">
        <P>
          <UI>Analytics</UI> in the sidebar covers the whole workspace. Each form also has its own
          view, which is the one to use when you are trying to improve a specific form.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="What is not collected">
        <P>
          No cross-site tracking, no third-party analytics on public form pages, and no per-person
          behavioural profile. Respondent IP addresses are stored as a salted hash for duplicate
          detection and are not reversible or reportable.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
