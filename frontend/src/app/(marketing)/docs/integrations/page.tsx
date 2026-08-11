import type { Metadata } from 'next';

import {
  Callout,
  Code,
  DocPage,
  DocSectionBlock,
  DocList,
  DocTable,
  P,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Integrations' };

export default function IntegrationsPage() {
  return (
    <DocPage
      href="/docs/integrations"
      title="Integrations"
      intro={
        <>
          Webhooks push each response to a URL you control as it arrives, so it can land in your own
          systems without anyone exporting a file. Admin only.
        </>
      }
    >
      <Callout type="warning" title="Webhooks are an admin capability for a reason">
        A webhook can send every response your organization collects to any address on the
        internet. That is why creating and editing them requires the Admin role, and why editors
        cannot see the page at all.
      </Callout>

      <DocSectionBlock title="Creating one">
        <P>
          Go to <UI>Integrations</UI>, add an endpoint, and choose which events it should receive.
          You are shown a <Term>signing secret</Term> once, at creation. Store it then — it is
          encrypted at rest and cannot be displayed again.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Verifying a delivery">
        <P>
          Every request carries a signature computed over the raw body with your secret. Verify it
          before trusting the payload, and compare using a constant-time comparison rather than
          string equality.
        </P>
        <P>
          Do not rely on the source address instead. Anyone can post to your endpoint; the
          signature is what makes a request provably ours.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Delivery behaviour">
        <DocTable
          columns={['Aspect', 'Behaviour']}
          rows={[
            [
              'Retries',
              'A non-2xx response or a timeout is retried with exponential backoff. Persistent failure eventually stops delivery and the endpoint is marked failing.',
            ],
            [
              'Ordering',
              'Not guaranteed. Under load two responses can arrive out of order — use the submission timestamp in the payload, not arrival order.',
            ],
            [
              'At-least-once',
              'A delivery can arrive more than once. Treat the submission id as an idempotency key.',
            ],
            [
              'Timeout',
              'Respond quickly. Do the work asynchronously and return 2xx as soon as you have accepted the payload.',
            ],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Endpoint requirements">
        <DocList
          items={[
            <>
              Must be <Code>https://</Code> and publicly resolvable.
            </>,
            <>
              Private and loopback addresses are refused. A webhook pointed at an internal address
              would make the platform fetch on your behalf from inside its own network.
            </>,
            <>Return 2xx on success. Anything else is treated as a failure and retried.</>,
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Other routes out">
        <P>
          For one-off analysis, export from <UI>Responses</UI> as CSV or Excel. For reference data
          going the other way — a list of schools from your own system into a dropdown — upload it
          as an option list rather than pasting it into each form.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
