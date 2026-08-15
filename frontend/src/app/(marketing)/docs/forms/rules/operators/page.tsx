import type { Metadata } from 'next';

import {
  Callout,
  Code,
  DocList,
  DocPage,
  DocSectionBlock,
  DocTable,
  P,
  Term,
} from '@/components/docs/primitives';
import { ExprBreakdown, MockRuleCard } from '@/components/docs/builder-ui';

export const metadata: Metadata = { title: 'Operators reference' };

export default function OperatorsPage() {
  return (
    <DocPage
      href="/docs/forms/rules/operators"
      title="Operators reference"
      intro={
        <>
          The complete, closed set of operators the rules engine understands — the same list the
          rule editor&apos;s operator picker offers, grouped the same way. There is no way to add
          one at runtime; every operator here is total (it returns a value or blank, and never
          throws) so a typo in a formula can never turn into an error page for a respondent.
        </>
      }
    >
      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Comparison">
        <P>
          Return <Code>true</Code> or <Code>false</Code>. They work on numbers <em>and</em> on date
          strings — no need to pick a different operator for dates.
        </P>

        <MockRuleCard kind="VALIDATE" target="end_date" formula="not(gt(end_date, start_date))" message="End date must be after the start date.">
          <ExprBreakdown
            lines={[
              { code: 'gt(end_date, start_date)', note: 'True when end_date falls after start_date. Both are DATE questions, so gt compares them as calendar dates, not text.' },
              { code: 'not( … )', depth: 1, note: 'Inverts it — now true exactly when end_date is NOT after start_date, which is the broken case Validate needs to describe.' },
            ]}
          />
        </MockRuleCard>

        <DocTable
          columns={['Operator', 'Inputs', 'What it checks']}
          rows={[
            [<Code key="eq">eq(a, b)</Code>, '2', 'a equals b. Works on text, numbers, booleans, and multi-choice lists (order-insensitive).'],
            [<Code key="neq">neq(a, b)</Code>, '2', 'a does not equal b.'],
            [<Code key="gt">gt(a, b)</Code>, '2', 'a is greater than b. Works on numbers and date strings.'],
            [<Code key="gte">gte(a, b)</Code>, '2', 'a is greater than or equal to b.'],
            [<Code key="lt">lt(a, b)</Code>, '2', 'a is less than b.'],
            [<Code key="lte">lte(a, b)</Code>, '2', 'a is less than or equal to b.'],
            [
              <Code key="btw">between(value, low, high)</Code>,
              '3',
              'value ≥ low and value ≤ high (inclusive on both ends). Works on numbers and dates.',
            ],
          ]}
        />
        <Callout type="tip" title="Date comparisons just work">
          Date fields store <Code>YYYY-MM-DD</Code> strings. <Code>gt(end_date, start_date)</Code>{' '}
          does the right thing without any conversion.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Logic">
        <MockRuleCard kind="SHOW" target="eligibility_note" formula="and(isFilled(district), eq(category, &quot;Primary&quot;))">
          <ExprBreakdown
            lines={[
              { code: 'isFilled(district)', depth: 1, note: 'True once the district question has any answer.' },
              { code: 'eq(category, "Primary")', depth: 1, note: 'True when category is exactly the text "Primary".' },
              { code: 'and( … , … )', note: 'True only when BOTH of the above are true — eligibility_note stays hidden until district is answered AND category is Primary.' },
            ]}
          />
        </MockRuleCard>

        <DocTable
          columns={['Operator', 'Inputs', 'What it does']}
          rows={[
            [<Code key="and">and(a, b, …)</Code>, '1 or more', 'True when every input is true. Takes any number of inputs.'],
            [<Code key="or">or(a, b, …)</Code>, '1 or more', 'True when at least one input is true.'],
            [<Code key="not">not(a)</Code>, '1', 'Inverts the truth value of its input.'],
            [
              <Code key="if">if(condition, then, otherwise)</Code>,
              '3',
              'Returns the "then" value when condition is true, the "otherwise" value when false. Useful in Calculate rules.',
            ],
            [
              <Code key="coal">coalesce(a, b, …)</Code>,
              '1 or more',
              'Returns the first input that is not blank. Use to fall back to a default value.',
            ],
          ]}
        />
        <Callout type="tip" title="Nesting and / or">
          There is no limit on nesting depth within the compile limits (24 levels, 256 nodes) — see{' '}
          <Term>Limits</Term> below.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Presence">
        <P>These check whether a question has any answer at all, regardless of the value.</P>
        <DocTable
          columns={['Operator', 'Inputs', 'What it checks']}
          rows={[
            [
              <Code key="filled">isFilled(field)</Code>,
              '1',
              'True when the question has any answer — including the number 0 or the text "false".',
            ],
            [
              <Code key="blank">isBlank(field)</Code>,
              '1',
              'True when the question has no answer — it was skipped or not yet reached.',
            ],
          ]}
        />
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Maths">
        <P>
          All maths operators return blank when any input cannot be converted to a number.
          Division and remainder by zero return blank rather than Infinity or NaN.
        </P>

        <MockRuleCard kind="CALCULATE" target="total_cost" formula="round(mul(unit_price, quantity), 2)">
          <ExprBreakdown
            lines={[
              { code: 'mul(unit_price, quantity)', depth: 1, note: 'Multiplies the two numeric answers together.' },
              { code: 'round( … , 2)', note: 'Rounds the product to 2 decimal places and stores it in total_cost, which the respondent cannot edit directly.' },
            ]}
          />
        </MockRuleCard>

        <DocTable
          columns={['Operator', 'Inputs', 'What it computes']}
          rows={[
            [<Code key="add">add(a, b, …)</Code>, '2 or more', 'Sum of all inputs.'],
            [<Code key="sub">sub(a, b)</Code>, '2', 'a minus b.'],
            [<Code key="mul">mul(a, b, …)</Code>, '2 or more', 'Product of all inputs.'],
            [<Code key="div">div(a, b)</Code>, '2', 'a divided by b. Returns blank when b is zero.'],
            [<Code key="mod">mod(a, b)</Code>, '2', 'Remainder of a ÷ b. Returns blank when b is zero.'],
            [<Code key="abs">abs(a)</Code>, '1', 'Absolute (positive) value of a.'],
            [<Code key="fl">floor(a)</Code>, '1', 'Round down to the nearest whole number.'],
            [<Code key="cl">ceil(a)</Code>, '1', 'Round up to the nearest whole number.'],
            [
              <span key="rnd"><Code>round(a)</Code> or <Code>round(a, digits)</Code></span>,
              '1–2',
              'Round to the nearest whole number, or to the specified number of decimal places (0–12).',
            ],
            [<Code key="min">min(a, b, …)</Code>, '1 or more', 'Smallest of all inputs.'],
            [<Code key="max">max(a, b, …)</Code>, '1 or more', 'Largest of all inputs.'],
          ]}
        />
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Dates">
        <P>
          Date operators accept <Code>YYYY-MM-DD</Code> strings (what date fields store) and full
          ISO datetime strings. All arithmetic runs in UTC so server recomputation agrees with
          the browser regardless of the respondent&apos;s timezone.
        </P>

        <MockRuleCard kind="CALCULATE" target="age_years" formula="yearsBetween(date_of_birth, today())">
          <ExprBreakdown
            lines={[
              { code: 'today()', depth: 1, note: "Today's date. On the server this is the submission timestamp, not the browser's clock, so a rule cannot be fooled by a wrong device clock." },
              { code: 'yearsBetween(date_of_birth, … )', note: 'Whole years elapsed between the two dates — how many birthdays have passed, not a fractional age.' },
            ]}
          />
        </MockRuleCard>

        <DocTable
          columns={['Operator', 'Inputs', 'What it returns']}
          rows={[
            [
              <Code key="td">today()</Code>,
              '0',
              "Today's date as YYYY-MM-DD. On the server, the submission timestamp is used — not the browser clock.",
            ],
            [
              <Code key="yb">yearsBetween(from, to)</Code>,
              '2',
              'Whole years elapsed from → to (how many birthdays have passed). Pair with today() to compute age.',
            ],
            [<Code key="mb">monthsBetween(from, to)</Code>, '2', 'Whole calendar months elapsed from → to.'],
            [<Code key="db">daysBetween(from, to)</Code>, '2', 'Full days elapsed from → to.'],
            [<Code key="ad">addDays(date, n)</Code>, '2', 'A date n days after date. n may be negative.'],
            [
              <Code key="am">addMonths(date, n)</Code>,
              '2',
              'A date n months after date. End-of-month clamped: 31 Jan + 1 month = 28 Feb, never 3 Mar.',
            ],
            [
              <Code key="fd">formatDate(date, pattern)</Code>,
              '2',
              <span key="fdesc">
                Format a date for display. Supported tokens:{' '}
                <Code>YYYY</Code> <Code>MM</Code> <Code>DD</Code> <Code>HH</Code> <Code>mm</Code>.
                Example: <Code>formatDate(dob, &quot;DD/MM/YYYY&quot;)</Code>
              </span>,
            ],
          ]}
        />
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Text">
        <DocTable
          columns={['Operator', 'Inputs', 'What it returns']}
          rows={[
            [
              <Code key="cc">concat(a, b, …)</Code>,
              '1 or more',
              'Joins all inputs as text. Blank values contribute nothing — not the word "null".',
            ],
            [<Code key="up">upper(a)</Code>, '1', 'Converts text to UPPERCASE.'],
            [<Code key="lo">lower(a)</Code>, '1', 'Converts text to lowercase.'],
            [<Code key="tr">trim(a)</Code>, '1', 'Removes leading and trailing spaces.'],
            [
              <Code key="ln">length(a)</Code>,
              '1',
              'Number of characters in text, or number of selected options in a multi-choice answer.',
            ],
            [
              <Code key="ct">contains(a, b)</Code>,
              '2',
              'Case-insensitive: does text a contain text b? Also works on multi-choice lists: does the selection include option b?',
            ],
            [<Code key="sw">startsWith(a, b)</Code>, '2', 'Case-insensitive: does text a start with text b?'],
          ]}
        />
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Lists">
        <P>
          These work on multi-choice answers (a list of selected values) and on repeating section
          answers (a list of per-entry sub-form responses).
        </P>

        <MockRuleCard kind="CALCULATE" target="total_children" formula="sumOf(household_members.children_count)">
          <ExprBreakdown
            lines={[
              {
                code: 'household_members.children_count',
                depth: 1,
                note: 'Every value entered for children_count, once per row of the household_members repeating section.',
              },
              { code: 'sumOf( … )', note: 'Adds every one of those per-row numbers into a single running total.' },
            ]}
          />
        </MockRuleCard>

        <DocTable
          columns={['Operator', 'Inputs', 'What it returns']}
          rows={[
            [
              <Code key="cnt">count(list)</Code>,
              '1',
              'Number of items in the list. For a multi-choice question: how many options are selected.',
            ],
            [<Code key="inc">includes(list, value)</Code>, '2', 'True when the list contains the given value.'],
            [
              <Code key="sum">sumOf(list)</Code>,
              '1',
              'Adds every numeric item in the list. Useful on repeating sections where each entry has a number field.',
            ],
            [<Code key="any">anyOf(list)</Code>, '1', 'True when at least one item in the list is truthy.'],
            [
              <Code key="all">allOf(list)</Code>,
              '1',
              'True when every item in the list is truthy. True for an empty list (vacuously).',
            ],
          ]}
        />
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Lookup: auto-fill from an option list">
        <P>
          When your option list carries extra data in its metadata columns — a UDISE code on a
          school list, a district code on a village list — a Calculate rule can copy that data into
          a read-only field the instant the respondent picks an option. No second dropdown, no
          transcription error.
        </P>

        <MockRuleCard kind="CALCULATE" target="udise_code" formula='lookup("ng-schools", school_name, "udise_code")'>
          <ExprBreakdown
            lines={[
              {
                code: 'lookup("ng-schools", school_name, "udise_code")',
                note: 'The udise_code metadata column of whichever item from the ng-schools list the respondent picked in school_name. The second argument must be a plain field reference, not a computed expression — enforced at publish time.',
              },
            ]}
          />
        </MockRuleCard>

        <DocTable
          columns={['Operator', 'Inputs', 'What it returns']}
          rows={[
            [
              <Code key="lk">lookup(list, field, column)</Code>,
              '3',
              <span key="lkd">
                The value stored in <Code>column</Code> of whichever item from{' '}
                <Code>list</Code> the respondent picked in <Code>field</Code>. Returns blank if the
                question is unanswered, the item is not in the list, or that column has no value for
                the item.
              </span>,
            ],
          ]}
        />
        <Callout type="note" title="Lookups are pre-resolved">
          The engine never fetches data during evaluation. All lookup values are resolved into a bag
          before the rule set runs — from the database on the server, from already-fetched cascade
          data in the browser. The same rule code runs on both sides and always agrees.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Cross-form references">
        <P>
          A form bound to a <Term>record type</Term> can read an answer given on another form{' '}
          <em>for the same subject</em>. A follow-up visit form can pre-fill the district from the
          registration form; a score form can read the previous baseline.
        </P>
        <DocTable
          columns={['When value', 'Which submission is read']}
          rows={[
            [<Term key="lat">Latest</Term>, 'The most recent submission of that form for this subject.'],
            [<Term key="fst">First</Term>, 'The earliest submission of that form for this subject.'],
            [<Term key="reg">Registration</Term>, 'The submission that created the subject record.'],
          ]}
        />
        <Callout type="warning" title="Requires a record type">
          Cross-form references are only available on forms bound to a record type. Without one the
          publish step rejects the rule — there is no subject to resolve the value against.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Calculated values are recomputed on the server">
        <Callout type="warning" title="The browser result is never trusted">
          Every Calculate rule is re-evaluated when the response is submitted. Whatever value the
          browser sent for a calculated field is discarded and replaced with the server&apos;s own
          result. A respondent posting a fabricated eligibility score changes nothing.
          Client-side evaluation exists so the respondent sees values update as they type — it is a
          preview, not the source of truth.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Limits enforced at publish time">
        <P>
          The compiler checks the complete rule set when you publish. Rules that would fail at
          runtime are rejected before any respondent sees the form.
        </P>
        <DocTable
          columns={['Limit', 'Value', 'Why']}
          rows={[
            ['Rules per form', '200', 'Keeps the compiled plan manageable and prevents accidental runaway automation.'],
            ['Nodes per expression', '256', 'Prevents trees so deeply nested they are unreadable to authors and slow to evaluate.'],
            ['Expression depth', '24 levels', 'A limit on nesting, not total node count.'],
          ]}
        />
        <P>The following are also caught and reported at publish time:</P>
        <DocList
          items={[
            <>
              <Term>Unknown operators</Term> — an operator name not in the built-in set is
              rejected. There is no way to inject custom code or eval.
            </>,
            <>
              <Term>Unknown field keys</Term> — a reference to a question that does not exist (or
              was deleted after the rule was written) is caught with the offending rule named.
            </>,
            <>
              <Term>Dependency cycles</Term> — if field A&apos;s Calculate rule references B and
              B&apos;s rule references A, publication fails and both fields are named. Detection
              runs across the whole rule set, not rule by rule.
            </>,
            <>
              <Term>Lookup restriction</Term> — the second argument to <Code>lookup()</Code> must
              be a bare field reference. An expression there would require multi-pass evaluation,
              which the engine does not support.
            </>,
          ]}
        />
      </DocSectionBlock>
    </DocPage>
  );
}
