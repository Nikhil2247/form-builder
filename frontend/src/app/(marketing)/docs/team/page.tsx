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

export const metadata: Metadata = { title: 'Team and roles' };

export default function TeamPage() {
  return (
    <DocPage
      href="/docs/team"
      title="Team and roles"
      intro={
        <>
          Who is in the workspace and what each of them can do. Managing the team requires the Admin
          role.
        </>
      }
    >
      <DocSectionBlock title="The three roles">
        <DocTable
          columns={['', 'Viewer', 'Editor', 'Admin']}
          rows={[
            ['View forms and responses', 'Yes', 'Yes', 'Yes'],
            ['Export responses', 'No', 'Yes', 'Yes'],
            ['Create, edit and publish forms', 'No', 'Yes', 'Yes'],
            ['Delete forms and responses', 'No', 'Yes', 'Yes'],
            ['Manage option lists', 'View only', 'Create and import', 'Everything, plus delete'],
            ['Invite and manage members', 'No', 'No', 'Yes'],
            ['Webhooks and integrations', 'No', 'No', 'Yes'],
            ['Organization settings and billing', 'No', 'No', 'Yes'],
            ['Organization audit log', 'No', 'No', 'Yes'],
          ]}
        />
        <Callout type="note" title="The interface follows the same table">
          Menu items you cannot use are not shown. That is a convenience, not the boundary — every
          one of these is re-checked on the server, so nothing is reachable by finding a URL.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Inviting someone">
        <P>
          <UI>Team → Invite member</UI> takes an email and a role. They receive a link; accepting it
          adds them to the organization with that role. Pending invitations are listed on the{' '}
          <UI>Invitations</UI> tab and can be revoked, which stops the link working.
        </P>
        <P>
          Someone can belong to several organizations with a different role in each. The workspace
          switcher in the sidebar moves between them, and everything on screen — forms, responses,
          records, option lists — belongs to whichever is active.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Changing a role or removing someone">
        <P>
          Use the actions menu at the end of a member&apos;s row. The role they currently hold is
          ticked. Removing someone revokes their access immediately; forms and responses they
          created stay with the organization.
        </P>
        <P>You cannot change your own role or remove yourself — that is how an organization ends up with no admin.</P>
      </DocSectionBlock>

      <DocSectionBlock title="Choosing a role">
        <P>
          <Term>Viewer</Term> for people who need to read results and nothing more — a funder, a
          programme lead, a colleague who reports on the numbers.
        </P>
        <P>
          <Term>Editor</Term> for the people who build and run forms. This is the working default
          for most of a team.
        </P>
        <P>
          <Term>Admin</Term> for the small number who manage the workspace itself. Admin includes
          webhooks, which can send every response you collect to an arbitrary address — worth
          remembering when deciding who needs it.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Super admin is a separate thing">
        <P>
          Platform administration runs on its own axis. A super admin is not automatically an admin
          of any organization, and an organization admin has no platform access. See{' '}
          <UI>Platform administration</UI>.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
