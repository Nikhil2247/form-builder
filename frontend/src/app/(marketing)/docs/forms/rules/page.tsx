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

export const metadata: Metadata = { title: 'Rules and calculations' };

export default function RulesPage() {
  return (
    <DocPage
      href="/docs/forms/rules"
      title="Rules and calculations"
      intro={
        <>
          Rules make your form intelligent without writing any code. Compute a field&apos;s value
          from other answers, show or hide a question based on a condition, make a question required
          only in certain situations, or reject a combination of answers that cannot be correct.
          Every rule is built visually in the rule editor and checked in full when you publish.
        </>
      }
    >
      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="The four rule kinds">
        <DocTable
          columns={['Kind', 'What it does', 'Expression meaning']}
          rows={[
            [
              <Term key="c">Calculate</Term>,
              "Derives a field's value from other answers. The respondent sees the result but cannot edit it — the formula owns the value.",
              'The formula to compute. Can reference other fields, arithmetic, date math, and lookups.',
            ],
            [
              <Term key="s">Show</Term>,
              "Shows a question only when a condition is true. While hidden the question's answer is cleared and not stored.",
              'The condition that must be true for the question to appear.',
            ],
            [
              <Term key="r">Require</Term>,
              'Makes a question mandatory only when a condition is true. Complements Show — you can require a follow-up only when it is visible.',
              'The condition under which an answer becomes required.',
            ],
            [
              <Term key="v">Validate</Term>,
              'Blocks submission when a condition is true, showing a message you write next to the field that caused the problem.',
              'Write the condition that is WRONG — the submission is blocked whenever this evaluates to true.',
            ],
          ]}
        />
        <Callout type="tip" title="Validate is inverted">
          Write the bad case, not the good case. To require a value between 1 and 100, write{' '}
          <Code>not(between(score, 1, 100))</Code> and set the message to &ldquo;Enter a number
          between 1 and 100.&rdquo;
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="How expressions work">
        <P>
          Expressions are trees built from four kinds of node, composed by choosing an operator and
          filling its inputs. Inputs can themselves be operators, field references, or constants.
          There is no text to type; the editor only offers operations the engine can evaluate.
        </P>
        <DocTable
          columns={['Node type', 'What it is', 'Example']}
          rows={[
            [
              <Term key="l">Literal</Term>,
              'A constant value you type in. Can be text, a number, true/false, or a list.',
              <span key="le"><Code>&quot;Male&quot;</Code>, <Code>18</Code>, <Code>true</Code>, <Code>[&quot;a&quot;,&quot;b&quot;]</Code></span>,
            ],
            [
              <Term key="f">Field</Term>,
              "The current answer to a question on this form, addressed by the question's key.",
              <span key="fe"><Code>date_of_birth</Code>, <Code>school_name</Code></span>,
            ],
            [
              <Term key="ref">Cross-form reference</Term>,
              'An answer from another form for the same subject (record-type forms only). Resolved before evaluation — the interpreter never touches a database.',
              <Code key="refe">registration@latest.district</Code>,
            ],
            [
              <Term key="o">Operation</Term>,
              'Application of a built-in operator to one or more inputs.',
              <Code key="oe">yearsBetween(date_of_birth, today())</Code>,
            ],
          ]}
        />
        <Callout type="note" title="Blank propagation">
          If any input to an operator is blank (question unanswered, lookup found nothing), the
          output is blank too. Blank is treated as <Code>false</Code> in Show, Require, and
          Validate, and as &ldquo;no value&rdquo; in Calculate. Operators never throw — bad input
          yields blank, not an error.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="What counts as true">
        <P>
          Show, Require, and Validate treat the expression result as a boolean:
        </P>
        <DocTable
          columns={['Value', 'Treated as']}
          rows={[
            [<Code key="t">true</Code>, 'True'],
            [
              <span key="f"><Code>false</Code>, <Code>null</Code> (blank), <Code>&quot;&quot;</Code> (empty text), <Code>[]</Code> (empty list)</span>,
              'False',
            ],
            [
              <Code key="z">0</Code>,
              'True — the number zero is a real answer, not the same as unanswered',
            ],
            ['Any non-empty string', 'True'],
            ['Any non-empty list', 'True'],
            ['Any non-zero number', 'True'],
          ]}
        />
        <Callout type="warning" title="Zero is truthy">
          Unlike JavaScript, <Code>0</Code> is truthy. <Code>isFilled(children_count)</Code> is{' '}
          <Code>true</Code> when the answer is 0. Use <Code>isBlank()</Code> to check whether a
          question was skipped entirely.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Comparison operators">
        <P>
          Comparison operators return <Code>true</Code> or <Code>false</Code>. They work on numbers{' '}
          <em>and</em> on date strings — no need to pick a different operator for dates.
        </P>
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
      <DocSectionBlock title="Logic operators">
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
          <Code>and(isFilled(district), eq(category, &quot;Primary&quot;))</Code> shows a question
          only when both conditions hold. There is no limit on nesting depth within the compile
          limits (24 levels, 256 nodes).
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Presence operators">
        <P>
          These check whether a question has any answer at all, regardless of the value.
        </P>
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
      <DocSectionBlock title="Maths operators">
        <P>
          All maths operators return blank when any input cannot be converted to a number.
          Division and remainder by zero return blank rather than Infinity or NaN.
        </P>
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
      <DocSectionBlock title="Date operators">
        <P>
          Date operators accept <Code>YYYY-MM-DD</Code> strings (what date fields store) and full
          ISO datetime strings. All arithmetic runs in UTC so server recomputation agrees with
          the browser regardless of the respondent&apos;s timezone.
        </P>
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
        <Callout type="tip" title="Age calculation">
          <Code>yearsBetween(date_of_birth, today())</Code> in a Calculate rule targeting a Number
          field — the respondent sees their age update as they fill in the date.
        </Callout>
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Text operators">
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
      <DocSectionBlock title="List operators">
        <P>
          These work on multi-choice answers (a list of selected values) and on repeating section
          answers (a list of per-entry sub-form responses).
        </P>
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
        <P>
          Example: <Code>lookup(&quot;ng-schools&quot;, school_name, &quot;udise_code&quot;)</Code> — the moment a
          school is selected, its UDISE code fills the read-only field. The second argument (
          <Code>school_name</Code>) must be a plain field reference, not a computed expression.
          This restriction is enforced at publish time.
        </P>
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
        <P>
          The server uses the same compiled rule set stored in the immutable form version, so it
          reproduces exactly what the respondent saw — no drift between browser and server.
        </P>
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

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Rule templates">
        <P>
          The rule editor offers ready-made starting points. Each template produces a valid rule
          that compiles as-is; you then swap a field or a constant to match your form.
        </P>
        <DocTable
          columns={['Template', 'Kind', 'What it builds']}
          rows={[
            [
              'Age from date of birth',
              'Calculate',
              <span key="t1">
                <Code>yearsBetween(date_field, today())</Code>. Swap the date field to match your
                question.
              </span>,
            ],
            [
              'Add two answers together',
              'Calculate',
              'Adds two numeric questions. Replace the second operand with another field or a constant.',
            ],
            [
              'Show when an answer matches',
              'Show',
              'Reveals a question when another has a specific value. Fill in the target value.',
            ],
            [
              'Show once something is answered',
              'Show',
              'Reveals a follow-up the moment an earlier question is filled in.',
            ],
            [
              'Require a follow-up',
              'Require',
              'Makes a question mandatory once another has any answer.',
            ],
            [
              'Reject a value outside a range',
              'Validate',
              <span key="t6">
                <Code>not(between(field, 0, 100))</Code> — blocks submission when a number falls
                outside the allowed band.
              </span>,
            ],
          ]}
        />
      </DocSectionBlock>

      {/* ─────────────────────────────────────────────────────────────────── */}
      <DocSectionBlock title="Rules vs. conditional logic">
        <P>
          The builder has two ways to make questions conditional:{' '}
          <Term>Conditional Logic</Term> (the simpler panel) and <Term>Rules</Term> (this page).
          Both can show or hide questions, but they are not duplicates.
        </P>
        <DocTable
          columns={['Capability', 'Conditional logic', 'Rules']}
          rows={[
            ['Show / hide a question', 'Yes', 'Yes — Show kind'],
            ['Skip to a page', 'Yes', 'No'],
            ['Calculated fields', 'No', 'Yes — Calculate kind'],
            ['Conditional requirement', 'No', 'Yes — Require kind'],
            ['Cross-field validation', 'No', 'Yes — Validate kind'],
            ['Date arithmetic', 'No', 'Yes'],
            ['Option list lookups', 'No', 'Yes'],
            ['Cross-form references', 'No', 'Yes'],
            ['Nesting depth', 'One condition', 'Up to 24 levels'],
          ]}
        />
        <P>
          Use Conditional Logic for simple &ldquo;if the answer is X, show Y&rdquo; cases and for
          page-jump navigation. Use Rules when you need calculations, nested conditions, date
          arithmetic, lookups, or cross-form data.
        </P>
      </DocSectionBlock>
    </DocPage>
  );
}
