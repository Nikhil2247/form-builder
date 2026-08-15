import type { Metadata } from 'next';

import { Callout, Code, DocPage, DocSectionBlock, P, Steps, Term, UI } from '@/components/docs/primitives';
import { ExprBreakdown, MockCanvas, MockFieldRow, MockRuleCard } from '@/components/docs/builder-ui';

export const metadata: Metadata = { title: 'Build a form, step by step' };

export default function FormExamplesPage() {
  return (
    <DocPage
      href="/docs/forms/examples"
      title="Build a form, step by step"
      intro={
        <>
          Three forms, built field by field, each written to exercise a different corner of the
          builder — an intake form for logic and calculation, a monitoring visit for cascading
          option lists and repeating sections, and a scored assessment for the scale question
          types. Every field named below is a real type in <UI>Field types</UI>, and every rule is
          real syntax from <UI>Rules and calculations</UI>.
        </>
      }
    >
      {/* ═══════════════════════════════════════════════════════════════════
          EXAMPLE 1 — Programme intake
          ═══════════════════════════════════════════════════════════════════ */}
      <DocSectionBlock title="Example 1 — Programme intake, with an age calculation and a conditional requirement">
        <P>
          An intake form for a scholarship programme: applicant details, an automatically computed
          age, and a second ID document that only some applicants need to provide.
        </P>

        <Steps
          items={[
            <>
              <Term>Page 1 — Applicant.</Term> Add a <UI>Short answer</UI> field labelled
              &ldquo;Full name&rdquo; and mark it <UI>Required</UI>. Add a <UI>Date</UI> field
              labelled &ldquo;Date of birth&rdquo;, also required. The builder derives their keys —{' '}
              <Code>full_name</Code> and <Code>date_of_birth</Code> — the moment you save, from the
              labels.
            </>,
            <>
              Add a <UI>Number</UI> field labelled &ldquo;Age (years)&rdquo;. Leave it blank for
              now — this is the field a rule is about to own.
            </>,
            <>
              Open <UI>Rules</UI> and add a <Term>Calculate</Term> rule targeting{' '}
              <Code>age_years</Code>, either from the &ldquo;Age from date of birth&rdquo; template
              or built by hand: <Code>yearsBetween(date_of_birth, today())</Code>. From this point
              the Age field is read-only in the form — the respondent sees it fill in as soon as
              they pick a date of birth.
            </>,
            <>
              Add a <UI>Select an option</UI> field labelled &ldquo;District&rdquo; and bind its
              options to your <Term>districts</Term> option list, rather than typing the options in
              by hand — see <UI>Option lists</UI> for how a list is uploaded once and reused.
            </>,
            <>
              <Term>Page 2 — Household.</Term> Add a <UI>Number</UI> field labelled
              &ldquo;Household size&rdquo;, required. Add a <UI>File upload</UI> field labelled
              &ldquo;Additional ID document&rdquo; — leave it not required; a rule is about to
              decide that.
            </>,
            <>
              Add a <Term>Require</Term> rule targeting the ID upload field:{' '}
              <Code>gt(household_size, 6)</Code>. Households above six people must provide the
              second document; everyone else can leave it blank and submit normally.
            </>,
          ]}
        />

        <MockCanvas title="Page 1 — Applicant">
          <MockFieldRow label="Full name" type="Short answer" badges={['Required']} />
          <MockFieldRow label="Date of birth" type="Date" badges={['Required']} />
          <MockFieldRow label="Age (years)" type="Number" detail="read-only" badges={['Calculated']} />
          <MockFieldRow label="District" type="Select an option" detail="option list: districts" />
        </MockCanvas>

        <MockCanvas title="Page 2 — Household">
          <MockFieldRow label="Household size" type="Number" badges={['Required']} />
          <MockFieldRow
            label="Additional ID document"
            type="File upload"
            detail="required above 6 people"
            badges={['Conditional']}
          />
        </MockCanvas>

        <MockRuleCard index={1} kind="CALCULATE" target="age_years" formula="yearsBetween(date_of_birth, today())">
          <ExprBreakdown
            lines={[{ code: 'yearsBetween(date_of_birth, today())', note: 'Whole years between the date of birth answer and the moment the form is evaluated.' }]}
          />
        </MockRuleCard>
        <MockRuleCard index={2} kind="REQUIRE" target="additional_id_document" formula="gt(household_size, 6)">
          <ExprBreakdown
            lines={[{ code: 'gt(household_size, 6)', note: 'Becomes mandatory only once household_size is answered with more than 6.' }]}
          />
        </MockRuleCard>

        <Callout type="tip" title="Why two pages">
          Splitting applicant details from household details is not cosmetic — <Code>date_of_birth</Code>{' '}
          has to exist on an earlier page than any rule that reads it. See <UI>Pages and layout</UI>.
        </Callout>
      </DocSectionBlock>

      {/* ═══════════════════════════════════════════════════════════════════
          EXAMPLE 2 — Monitoring visit
          ═══════════════════════════════════════════════════════════════════ */}
      <DocSectionBlock title="Example 2 — Field monitoring visit, with cascading location and a repeating section">
        <P>
          A monitoring visit form for a field team: a location that narrows in three steps, and a
          repeating block for however many issues the visit turns up — none, one, or a dozen.
        </P>

        <Steps
          items={[
            <>
              Add three <UI>Select an option</UI> fields — &ldquo;District&rdquo;,
              &ldquo;Block&rdquo;, &ldquo;School&rdquo; — bound to three option lists that
              cascade: Block&apos;s options are filtered to the ones whose parent is the chosen
              District, and School&apos;s to the chosen Block. The respondent never sees a school
              from the wrong district. Full mechanics in{' '}
              <UI>Cascading and lookups</UI>.
            </>,
            <>
              Add a <UI>Date</UI> field labelled &ldquo;Visit date&rdquo;, required.
            </>,
            <>
              Add a <UI>Repeating section</UI> labelled &ldquo;Issues found&rdquo;, containing two
              sub-questions: a <UI>Select an option</UI> for &ldquo;Issue type&rdquo; (Water supply,
              Sanitation, Electricity, Other) and a <UI>Long answer</UI> for
              &ldquo;Description&rdquo;. The field worker adds one entry per issue and can add zero.
            </>,
            <>
              Add a <UI>Number</UI> field labelled &ldquo;Total issues&rdquo; and a{' '}
              <Term>Calculate</Term> rule targeting it: <Code>count(issues_found)</Code> — the
              running count updates as entries are added or removed, with nothing for the field
              worker to tally by hand.
            </>,
          ]}
        />

        <MockCanvas title="Location — cascading">
          <MockFieldRow label="District" type="Select an option" detail="option list: districts" />
          <MockFieldRow label="Block" type="Select an option" detail="cascades from District" badges={['Cascading']} />
          <MockFieldRow label="School" type="Select an option" detail="cascades from Block" badges={['Cascading']} />
        </MockCanvas>

        <MockCanvas title="Visit">
          <MockFieldRow label="Visit date" type="Date" badges={['Required']} />
          <MockFieldRow label="Issues found" type="Repeating section" detail="Issue type, Description per entry" />
          <MockFieldRow label="Total issues" type="Number" detail="read-only" badges={['Calculated']} />
        </MockCanvas>

        <MockRuleCard kind="CALCULATE" target="total_issues" formula="count(issues_found)">
          <ExprBreakdown
            lines={[{ code: 'count(issues_found)', note: 'The number of entries currently in the repeating section — zero when none have been added yet.' }]}
          />
        </MockRuleCard>

        <Callout type="note" title="Auto-fill goes further than cascading">
          If the schools list carries a UDISE code in its metadata, a fourth Calculate rule —{' '}
          <Code>lookup(&quot;schools&quot;, school, &quot;udise_code&quot;)</Code> — can fill a
          read-only code field the instant a school is picked. See <UI>Operators reference</UI>.
        </Callout>
      </DocSectionBlock>

      {/* ═══════════════════════════════════════════════════════════════════
          EXAMPLE 3 — Scored assessment
          ═══════════════════════════════════════════════════════════════════ */}
      <DocSectionBlock title="Example 3 — Training feedback, with scales and a validated range">
        <P>
          A short feedback form built around the rating field types, laid out in{' '}
          <Term>Grid</Term> mode so it fits on one screen instead of a long scroll.
        </P>

        <Steps
          items={[
            <>
              In <UI>Form settings</UI>, set the layout to <Term>Grid</Term>. Short questions now
              sit two to a row automatically — see <UI>Pages and layout</UI> for which types take a
              half row and which always take the whole one.
            </>,
            <>
              Add a <UI>Star rating</UI> field labelled &ldquo;Overall quality&rdquo;.
            </>,
            <>
              Add an <UI>NPS</UI> field labelled &ldquo;How likely are you to recommend this
              training?&rdquo; — the standard eleven-point 0–10 scale, always full width since
              eleven buttons in a row need it.
            </>,
            <>
              Add a <UI>Matrix</UI> field labelled &ldquo;Rate each session&rdquo; with one row per
              session and columns Poor / Fair / Good / Excellent.
            </>,
            <>
              Add a <UI>Number</UI> field labelled &ldquo;Minutes spent&rdquo; with a minimum of{' '}
              <Code>0</Code> and maximum of <Code>600</Code> set directly on the field&apos;s own
              validation — no rule needed for a plain range like this one.
            </>,
            <>
              Add a <Term>Validate</Term> rule for the rare case a plain field-level range can not
              express: the NPS score and the star rating disagreeing badly enough to be worth a
              second look — <Code>and(lt(overall_quality, 3), gt(recommend_score, 8))</Code>, with
              the message &ldquo;A low quality rating alongside a high recommendation score — please
              check both answers.&rdquo;
            </>,
          ]}
        />

        <MockCanvas title="Feedback (Grid layout)">
          <MockFieldRow label="Overall quality" type="Star rating" detail="half width" />
          <MockFieldRow label="Recommend score" type="NPS" detail="full width" />
          <MockFieldRow label="Rate each session" type="Matrix" detail="full width" />
          <MockFieldRow label="Minutes spent" type="Number" detail="0–600" />
        </MockCanvas>

        <MockRuleCard
          kind="VALIDATE"
          target="overall_quality"
          formula="and(lt(overall_quality, 3), gt(recommend_score, 8))"
          message="A low quality rating alongside a high recommendation score — please check both answers."
        >
          <ExprBreakdown
            lines={[
              { code: 'lt(overall_quality, 3)', depth: 1, note: 'True when the star rating is 1 or 2 out of 5.' },
              { code: 'gt(recommend_score, 8)', depth: 1, note: 'True when the NPS answer is 9 or 10.' },
              { code: 'and( … , … )', note: 'Blocks submission only when BOTH extremes are present at once — a genuinely inconsistent pair of answers, not just a low score on its own.' },
            ]}
          />
        </MockRuleCard>
      </DocSectionBlock>
    </DocPage>
  );
}
