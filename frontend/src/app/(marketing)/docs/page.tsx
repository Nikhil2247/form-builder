import type { Metadata } from 'next';

import { DOC_SECTIONS } from '@/config/docs';
import {
  Callout,
  DocLinkGrid,
  DocPage,
  DocSectionBlock,
  P,
  Term,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'Overview' };

export default function DocsOverviewPage() {
  return (
    <DocPage
      href="/docs"
      title="Documentation"
      intro={
        <>
          Formora collects structured data — from a one-page contact form to a multi-form field
          programme run across hundreds of sites. This is the reference for every part of it. If
          you are new, read <Term>Quickstart</Term> and <Term>Core concepts</Term> first; they take
          about ten minutes together and make everything else easier to place.
        </>
      }
    >
      <DocSectionBlock title="Which part do I need?">
        <P>
          Most of the platform is one of three things, and knowing which one your problem is saves
          a lot of reading.
        </P>
        <P>
          A <Term>form</Term> is a single questionnaire with a public link. Someone opens it, fills
          it in, and their answers become a response. That is the right tool for a survey, an
          intake form, a registration, a feedback request.
        </P>
        <P>
          A <Term>data app</Term> is several forms bound to the same subject and filled as one
          session — a monitoring visit that records the school, the training given and the
          observations made, all against that school&apos;s record. Reach for it when the same
          thing is measured repeatedly over time and you need the history in one place.
        </P>
        <P>
          An <Term>option list</Term> is reference data that dropdowns draw from — states,
          districts, schools, cost centres. Upload it once and every question bound to it stays in
          step, instead of the same list being retyped into thirty forms.
        </P>
      </DocSectionBlock>

      <Callout type="tip" title="Everything here is permission-aware">
        What you can see in the product depends on your role. Pages describing admin or
        super-admin tools say so at the top, so you can tell &ldquo;I cannot find this&rdquo; from
        &ldquo;I am not allowed to see this&rdquo;.
      </Callout>

      {DOC_SECTIONS.map((section) => (
        <DocSectionBlock key={section.title} title={section.title}>
          <P>{section.summary}</P>
          <DocLinkGrid pages={section.pages.filter((page) => page.href !== '/docs')} />
        </DocSectionBlock>
      ))}
    </DocPage>
  );
}
