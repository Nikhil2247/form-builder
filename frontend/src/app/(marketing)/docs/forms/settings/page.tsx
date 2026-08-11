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

export const metadata: Metadata = { title: 'Form settings' };

export default function SettingsPage() {
  return (
    <DocPage
      href="/docs/forms/settings"
      title="Form settings"
      intro={
        <>
          Who can respond, how many times, until when, and where the form lives. All of it is
          enforced when a response is submitted, not merely hidden in the interface.
        </>
      }
    >
      <DocSectionBlock title="The public link">
        <P>
          Every form gets a link of the form <Code>/f/your-form</Code>. The last segment is
          generated when the form is created and can be changed in <UI>Settings</UI> to something
          readable before you share it.
        </P>
        <P>
          Links are unique across the whole platform, so a name someone else has taken will be
          refused. Lowercase letters, digits and hyphens only — anything else is converted for you
          rather than rejected.
        </P>
        <Callout type="warning" title="Changing a link that is already out there">
          The old address stops working immediately. If you have already emailed it or printed it
          on something, change the link before you share it, not after.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Access">
        <DocTable
          columns={['Setting', 'Effect']}
          rows={[
            [
              'Require sign-in',
              'Only signed-in users may submit. The form says so up front rather than letting someone fill twenty questions and then bounce off a refusal.',
            ],
            [
              'Password protection',
              'A password is required before the form can be submitted. The flag only takes effect once a password has actually been set — otherwise the form would demand one nothing could satisfy.',
            ],
            [
              'Allow multiple responses',
              'Off means one response per respondent, checked against sign-in where available and a device fingerprint otherwise.',
            ],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Limits">
        <DocTable
          columns={['Setting', 'Effect']}
          rows={[
            [
              'Response cap',
              'After this many responses the form closes itself and says so. Useful for limited places on a course or a workshop.',
            ],
            [
              'Expiry date',
              'After this moment the form stops accepting responses and tells visitors it has closed, rather than 404-ing as though the link were wrong.',
            ],
          ]}
        />
        <P>
          Both produce a &ldquo;no longer accepting responses&rdquo; message rather than a missing
          page. Someone who arrives late had the right link; telling them otherwise sends them off
          to ask for it again.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Notifications">
        <P>
          Add email addresses to be notified when a response arrives. Each is sent a summary, not
          the full response — an inbox is the wrong place for collected data, and forwarding one
          email should not forward someone&apos;s answers.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Status">
        <P>A form is always in exactly one of four states:</P>
        <DocTable
          columns={['Status', 'Meaning']}
          rows={[
            ['Draft', 'Never published. The public link shows nothing.'],
            ['Published', 'Live and accepting responses.'],
            [
              'Closed',
              'Was live; reached its cap or expiry, or was closed by hand. Visitors are told it has closed.',
            ],
            ['Archived', 'Retired. Responses are kept and remain exportable.'],
          ]}
        />
        <P>
          Deleting a form is a <Term>soft delete</Term>: it moves to Trash, where it can be
          restored. Responses survive the whole time.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
