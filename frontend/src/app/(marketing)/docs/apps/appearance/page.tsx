import type { Metadata } from 'next';

import {
  Callout,
  Compare,
  DocPage,
  DocSectionBlock,
  DocTable,
  DocList,
  P,
  Term,
  UI,
} from '@/components/docs/primitives';

export const metadata: Metadata = { title: 'App appearance' };

export default function AppAppearancePage() {
  return (
    <DocPage
      href="/docs/apps/appearance"
      title="App appearance"
      intro={
        <>
          An app is a surface in its own right, not a themed form. These settings change its shape —
          how steps are paged, how wide the page runs, and how it is dressed — separately from its
          colours.
        </>
      }
    >
      <P>
        Everything here lives in <UI>App settings → Design → Appearance</UI>. Colours, fonts and
        corner radius are the <UI>Palette</UI> section below it, and the two are deliberately
        independent: an app can be recoloured without being rearranged.
      </P>

      <DocSectionBlock title="How steps are shown">
        <P>
          The one setting that changes how the app is used rather than how it looks.
        </P>
        <DocTable
          columns={['Option', 'What a respondent sees']}
          rows={[
            [
              'Stacked page',
              'Every step on one long page, filled top to bottom. The default, and the right choice for a short programme.',
            ],
            [
              'One step at a time',
              'A page per step, with a progress bar, numbered chips and Back / Next. Submit appears only on the last step.',
            ],
          ]}
        />
        <P>
          Paging suits a long programme, where a single page of every question at once is
          discouraging to open. It changes nothing about how the report is filed: answers are still
          staged as you go and everything is still submitted together at the end.
        </P>
        <Callout type="note" title="Errors take you to the step that caused them">
          Submission is validated across the whole report, so a problem on step one is found when
          you submit on step four. Every line in the error summary is a link to its step, the first
          offending step opens automatically, and its chip is marked. You are never told a report
          cannot be submitted without being shown where.
        </Callout>
        <P>
          Moving between steps never loses anything — you can jump forward and back freely using the
          chips, including to a step you have not reached yet, and answers stay exactly as typed.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Page width">
        <P>
          How much of a large screen the app fills. Every option is an upper bound, so a phone
          renders the same however you set it.
        </P>
        <DocTable
          columns={['Width', 'Best for']}
          rows={[
            ['Narrow', 'A short, reading-length form. The measure a single form uses.'],
            ['Medium', 'A general-purpose middle ground.'],
            ['Wide', 'The default. Several steps, or repeatable entries.'],
            ['Full width', 'Dense data entry — many short fields, or a wide matrix.'],
          ]}
        />
        <Callout type="tip" title="Width and layout work together">
          A wide page with a stacked layout gives you very long input boxes and little else. If you
          widen the page, consider <UI>Layout → Two column</UI> or{' '}
          <UI>Follow each form</UI> so the extra room is used for a second column rather than for
          stretching every field.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Header">
        <DocTable
          columns={['Style', 'What it is']}
          rows={[
            ['Plain card', 'Title, description and period on a card. The default.'],
            ['Colour wash', 'Your brand colour as a band behind the title. Needs no image.'],
            ['Cover image', 'A full-bleed image with the title over it.'],
            ['Slim bar', 'A single line and a rule under it, for dense internal tools.'],
          ]}
        />
        <Callout type="note" title="Cover image needs a cover image">
          Pick <UI>Cover image</UI> without one set and the colour wash is shown instead, rather
          than an empty grey band. Add one at <UI>Design → Branding → Cover image URL</UI> and it
          takes effect immediately.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Step headings">
        <DocList
          items={[
            <>
              <Term>Underlined heading</Term> — a title with a rule beneath it. The default.
            </>,
            <>
              <Term>Numbered timeline</Term> — numbered discs joined by a connecting line, so the
              order of the steps is visible at a glance.
            </>,
            <>
              <Term>Collapsible</Term> — each step folds away once finished. Useful when a step
              holds many repeated entries.
            </>,
            <>
              <Term>Plain heading</Term> — the title alone, for the least chrome.
            </>,
          ]}
        />
        <P>
          A collapsed step reopens automatically if submission finds a problem inside it, so nothing
          can hide an error.
        </P>
      </DocSectionBlock>

      <DocSectionBlock title="Spacing and background">
        <P>
          <Term>Spacing</Term> — compact, comfortable or spacious — sets the page padding, the gaps
          between steps and the padding inside cards. It does not change the spacing between
          individual fields, which is fixed so that a form looks the same inside an app as it does
          on its own link. Compact is tighter, not smaller.
        </P>
        <P>
          <Term>Background</Term> adds dots, a grid, a colour mesh or a single accent bar across the
          top of the page. All are drawn from your own palette, so they cost no image and cannot
          clash with your colours.
        </P>
        <Callout type="warning" title="Backgrounds are hidden behind glass cards">
          If the palette&apos;s card style is <UI>Glass</UI>, the background pattern is suppressed:
          glass is translucent, and a pattern showing through a card makes the text on it hard to
          read. Your choice is kept and returns if you switch to solid cards.
        </Callout>
      </DocSectionBlock>

      <DocSectionBlock title="Layout and field widths">
        <P>
          <UI>Design → Layout</UI> decides how the fields inside each step are arranged. This is the
          setting that governs whether a question&apos;s <Term>half</Term> or <Term>full</Term>{' '}
          width is honoured.
        </P>
        <DocTable
          columns={['Option', 'Effect on every step']}
          rows={[
            ['Stacked', 'One field per row, whatever the form was built as.'],
            ['Two column', 'Narrow fields pair up, whatever the form was built as.'],
            [
              'Follow each form',
              'Each step uses the layout its form was designed with, so per-question widths apply.',
            ],
          ]}
        />
        <Callout type="warning" title="Field widths only exist in a two-column layout">
          A question&apos;s width is meaningless in a stacked layout — everything takes a full row.
          So a two-column form with carefully paired fields renders as a plain stacked list the
          moment its app is set to <UI>Stacked</UI>, even though it pairs correctly on its own{' '}
          <UI>/f/</UI> link. If your widths are being ignored inside an app, this is why: choose{' '}
          <UI>Follow each form</UI>.
        </Callout>
        <Compare
          doTitle="Choose Follow each form when"
          dontTitle="Impose one layout when"
          doItems={[
            <>Your forms were designed individually, with deliberate field widths.</>,
            <>One step is a dense grid of codes and another is mostly long answers.</>,
            <>You are using one step at a time, where each step is its own page anyway.</>,
          ]}
          dontItems={[
            <>The steps should feel like one continuous document.</>,
            <>The forms were never given widths, so there is nothing to inherit.</>,
            <>A column count changing between steps would look like a fault.</>,
          ]}
        />
        <P>
          Conversational forms are always shown stacked inside an app. An app already paces the
          respondent with its own steps, and one question at a time inside a paged step would be a
          wizard within a wizard.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
