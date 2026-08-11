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

export const metadata: Metadata = { title: 'Platform administration' };

export default function PlatformPage() {
  return (
    <DocPage
      href="/docs/platform"
      title="Platform administration"
      intro={
        <>
          Tools for whoever runs the deployment, not for any one organization. Requires the{' '}
          <Term>super admin</Term> system role.
        </>
      }
    >
      <Callout type="note" title="A separate axis from organization roles">
        A super admin is not automatically an admin — or even a member — of any organization. The
        two are independent, so platform access does not silently grant access to a tenant&apos;s
        data.
      </Callout>

      <DocSectionBlock title="What is under Platform">
        <DocTable
          columns={['Page', 'What it does']}
          rows={[
            ['Overview', 'Platform-wide counts and recent activity.'],
            [
              'Organizations',
              'Every workspace, its limits and usage. Suspending one blocks its forms and apps from accepting responses without deleting anything.',
            ],
            [
              'Users',
              'Every account. Grant or revoke the super admin role, review sessions, and see which organizations someone belongs to.',
            ],
            ['Roles', 'Reference for what each role can do.'],
            [
              'System health',
              'Dependency probes and queue depth for the instance that answered. Process memory and uptime are per-pod, not aggregate.',
            ],
            [
              'Features',
              'Turn capabilities on globally or for one organization. Data apps are gated this way.',
            ],
            ['Audit logs', 'Every organization’s audit trail, plus platform-level actions.'],
            [
              'Global dictionary',
              'Option lists shared by every organization. See below.',
            ],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Feature flags">
        <P>
          A flag has a <Term>global default</Term> and optional <Term>per-organization
          overrides</Term>. Clearing an override is not the same as switching it off — it returns
          that organization to following whatever the default becomes.
        </P>
        <P>
          Flags gate what is rendered, never what is permitted. Turning one on in a browser reveals
          menus, not data; the API decides access independently.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="The global dictionary">
        <P>
          <UI>Platform → Global dictionary</UI> holds option lists with no owning organization.
          Every tenant can read them and none can edit them. India&apos;s states and districts ship
          this way; anything every tenant would otherwise upload separately belongs here — country
          codes, a national registry, standard designations.
        </P>
        <P>
          It works exactly like an organization&apos;s own dictionary: create a list, download the
          template, upload a CSV, map the columns, choose replace or add. An organization that needs
          a corrected version creates its own list with the same id, which takes precedence for them
          alone.
        </P>
        <Callout type="warning" title="These lists are shared">
          A replace-mode import against a global list retires options for every organization at
          once. Anything retired stops being offered everywhere, though past responses still resolve
          to a label. Export first if you are not certain what the file will change.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Suspending an organization">
        <P>
          Suspension stops its forms and apps accepting responses and tells visitors they are
          unavailable. Nothing is deleted, and lifting the suspension restores service. It is the
          right tool for a billing dispute or an investigation — deletion is not.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
