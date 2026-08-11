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

export const metadata: Metadata = { title: 'Organization settings' };

export default function OrganizationPage() {
  return (
    <DocPage
      href="/docs/organization"
      title="Organization settings"
      intro={<>The workspace itself: its name, its shared branding, its limits, and its audit trail. Admin only.</>}
    >
      <DocSectionBlock title="General">
        <P>
          The organization&apos;s name appears in the workspace switcher and on public form pages
          that have not set their own branding. Its logo is the fallback for every form and app that
          leaves the logo field blank — set it once here rather than on each of thirty forms.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Limits">
        <DocTable
          columns={['Limit', 'What happens at the ceiling']}
          rows={[
            [
              'Forms',
              'Creating another is refused with a message naming the limit. Existing forms are unaffected.',
            ],
            [
              'Responses per month',
              'Further submissions are refused until the month rolls over. Counted across every form in the organization.',
            ],
            [
              'Option lists',
              'Creating another is refused. Platform lists do not count towards it — they are not yours.',
            ],
          ]}
        />
        <Callout type="note" title="Rejected submissions do not count">
          A form that has hit its own response cap does not consume the organization&apos;s monthly
          allowance when it turns someone away. Only accepted responses count.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Option lists">
        <P>
          <UI>Organization → Option lists</UI> is the workspace&apos;s dictionary: your own lists,
          plus the platform lists available to everyone. See <UI>Option lists</UI>.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="The audit log">
        <P>
          <UI>Audit log</UI> records who did what and when: forms created, published and deleted;
          members invited, promoted and removed; settings changed; option lists imported.
        </P>
        <P>
          It is append-only. Entries are never edited or removed, which is what makes it worth
          consulting when something has changed and nobody remembers changing it.
        </P>
        <P>
          Form autosave does not fill it. The builder writes every couple of seconds, so logging
          each save would bury the trail under a record per keystroke — only meaningful changes,
          such as the public link or access settings, produce an entry.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Multiple organizations">
        <P>
          One account can belong to several, with a different <Term>role</Term> in each. Switch with
          the workspace switcher in the sidebar. Nothing is shared between them: forms, responses,
          records and option lists all belong to exactly one organization, and the separation is
          enforced on every request rather than by filtering in the browser.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
