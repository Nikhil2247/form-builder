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

export const metadata: Metadata = { title: 'Theme and branding' };

export default function ThemePage() {
  return (
    <DocPage
      href="/docs/forms/theme"
      title="Theme and branding"
      intro={
        <>
          A published form is a page people will judge before they answer anything on it. The theme
          panel controls how it looks, per form, with a live preview.
        </>
      }
    >
      <DocSectionBlock title="What you can change">
        <DocTable
          columns={['Setting', 'Notes']}
          rows={[
            [
              'Preset',
              'A coordinated starting point. Pick one, then adjust — faster and more consistent than choosing six colours from scratch.',
            ],
            [
              'Primary colour',
              'Buttons, focus rings, progress and selected states.',
            ],
            [
              'Background and card colour',
              'The page behind the form and the surface it sits on. Keep enough contrast between them or the form stops reading as a distinct object.',
            ],
            ['Text colour', 'Body text. Check it against your card colour, not the background.'],
            ['Typeface', 'From a curated set, so the form loads without waiting on a font.'],
            ['Corner radius', 'Applied consistently to inputs, cards and buttons.'],
            [
              'Card style',
              'How much the form separates from the page — a flat surface, a bordered card, or an elevated one.',
            ],
          ]}
        />
      </DocSectionBlock>

      <DocSectionBlock title="Logo and cover image">
        <P>
          A <Term>logo</Term> appears above the form title; a <Term>cover image</Term> spans the top
          of the page. Both are URLs you supply, and both must start with{' '}
          <UI>http://</UI> or <UI>https://</UI> — anything else is dropped when saved, because these
          values end up in an image tag on a public page.
        </P>
        <P>
          Leave the logo blank to fall back to the organization&apos;s logo, so a consistent brand
          across dozens of forms does not have to be set on each one.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Accessibility">
        <Callout type="warning" title="Contrast is your responsibility">
          The preview shows you what respondents will see, but nothing stops you choosing pale grey
          text on a white card. Check that body text is comfortably readable and that the primary
          colour is distinguishable against your background — a form nobody can read is a form
          nobody completes.
        </Callout>
        <P>
          Focus rings, keyboard navigation and screen-reader labelling are built into the controls
          and are not affected by theme choices. Every field has a real label, and errors are
          announced rather than only shown in colour.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="App theming">
        <P>
          Data apps have their own theme, set in <UI>App settings → Design</UI>, and it applies to
          every step. An app is a branded surface in its own right — it does not inherit the theme
          of whichever form happens to be step two.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
