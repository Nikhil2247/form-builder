/**
 * The help/guide bot's knowledge base.
 *
 * Kept as plain TypeScript rather than markdown files on disk: this repo has
 * no asset-copying step in its Nest build (see mail.service.ts for the same
 * inline-content convention with email templates), so a file read at runtime
 * would need its own `dist`-copying setup for no real benefit at this corpus
 * size. Add a doc by appending to HELP_DOCS below — the whole corpus is
 * inlined into the shared system prompt (see ../system-prompts.ts), not
 * searched per-request, so a new doc is live everywhere as soon as it's
 * added here.
 *
 * Audience: the people who actually build forms — program staff, not
 * developers. Keep language plain, avoid internal names where a user-facing
 * one exists, and write for someone who has never seen this platform before.
 */
export interface HelpDoc {
  id: string;
  title: string;
  /** Extra search terms beyond what appears in the title/body. */
  tags: string[];
  body: string;
}

export const HELP_DOCS: HelpDoc[] = [
  {
    id: 'building-a-form',
    title: 'Building your first form',
    tags: ['create', 'new form', 'builder', 'getting started'],
    body: `To create a form, go to Forms and click "New Form" — either start blank or from a template. A new form starts in Draft status, which means it's invisible to respondents and you can freely rearrange, add, or remove questions without any restrictions.

Add questions from the question panel and drag to reorder them. Every question needs a clear label — write it the way you'd ask the question out loud, not as an internal field name. Group related questions onto separate pages if the form is long; long single-page forms feel more tedious to fill out, especially on a phone.

When the form is ready, click Publish. Publishing locks in a snapshot (a "version") of the form's questions and rules, and from then on the form accepts real submissions. You can still edit a published form, but any structural change — adding, removing, or changing a question — creates a new version rather than silently altering the one people have already answered. This is what keeps old submissions readable even after you change the form later.`,
  },
  {
    id: 'question-types',
    title: 'Choosing the right question type',
    tags: ['field type', 'question type', 'input type'],
    body: `Pick the simplest question type that captures the answer correctly — it's easier for respondents and gives you cleaner data.

Text: Short Text (a single line, e.g. a name), Long Text (a paragraph, e.g. comments), Email (validates the format), Phone (accepts international prefixes), URL (validates it's a link).

Numbers: Number (plain numeric input), Slider (a numeric value picked from a range — good when the exact number matters less than roughly where it falls), Star Rating (1-5), NPS (0-10, Net Promoter Score).

Choices: Single Choice (radio buttons — exactly one answer), Multi Choice (checkboxes — one or more answers), Dropdown (a select list — exactly one answer, better than radio buttons when there are many options).

Structure: Section Header (a visual divider with no answer — use it to break a long form into labeled parts), Matrix (a grid of the same question asked across several rows, e.g. rating five statements on the same scale), Repeating Section (a group of questions the respondent can duplicate, e.g. "add another child").

Other: Date, File Upload, and Signature (captured as a drawn signature).

If you're unsure between Single Choice and Dropdown: Single Choice is faster to scan when there are 2-5 options; Dropdown is better once there are more than that.`,
  },
  {
    id: 'validation-rules',
    title: 'Requiring answers and validating input',
    tags: [
      'required',
      'validation',
      'require rule',
      'validate rule',
      'mandatory',
    ],
    body: `There are two ways to constrain an answer.

The simplest is the Required toggle on a question — the form won't submit until that question is answered. Use this for anything the form genuinely cannot function without.

For anything more conditional — "require this field only if that other answer was X", or "this number must be between 1 and 100" — use a rule instead. Rules come in two relevant kinds here: a REQUIRE rule makes a question mandatory only when a condition you define is true (rather than always), and a VALIDATE rule rejects an answer that doesn't satisfy a condition, showing the message you write for it. A VALIDATE rule without a clear message is confusing to whoever fills out the form — always write what's wrong and, where possible, what a valid answer looks like.

Rules are checked both live in the browser as someone fills out the form, and again on the server when the submission arrives — so a rule can't be bypassed by disabling JavaScript or calling the API directly.`,
  },
  {
    id: 'calculated-fields',
    title: 'Calculated fields',
    tags: ['calculate rule', 'formula', 'computed field', 'auto-fill'],
    body: `A CALCULATE rule fills in a question's value automatically from other answers on the form — a total, an age computed from a date of birth, a derived category. The respondent doesn't type into a calculated field directly; the platform computes it as they fill out the rest of the form.

Calculated fields can also pull in an answer from the person's earlier submissions on a different but related form (for example, a follow-up visit form referencing the registration form for the same person). Ask the help bot to look at your specific form if you want a rule proposed for it — describe what you want calculated and it will check that the calculation is actually expressible before suggesting it, so you never get a rule that fails when you try to publish.

Calculated values are also usable as inputs to other rules — a SHOW or VALIDATE rule can react to a calculated field the same way it reacts to a directly-entered answer.`,
  },
  {
    id: 'show-hide-logic',
    title: 'Showing and hiding questions conditionally',
    tags: ['conditional', 'skip logic', 'show rule', 'hide', 'branching'],
    body: `Most forms have at least one question that only makes sense given an earlier answer — "if you selected Other, please specify," or an entire section that only applies to one kind of respondent.

A SHOW rule reveals a question (or keeps it hidden) based on a condition over earlier answers. Conditions can check things like whether an answer equals a value, doesn't equal it, contains it (for multi-choice), is greater or less than a number, or is simply filled in at all.

Keep conditional branches shallow where you can — a question whose visibility depends on three other conditional questions is hard for both the form's author and a future editor to reason about. If a form's logic is getting complicated, it's worth asking the help bot to explain what a specific question's current visibility rule actually does before adding another layer to it.`,
  },
  {
    id: 'publishing-and-versions',
    title: 'Draft, Published, and versions',
    tags: ['publish', 'draft', 'version', 'edit published form', 'archive'],
    body: `A form has one of four states: Draft (editable, not accepting submissions), Published (accepting submissions), Archived (closed to new submissions, all past data preserved), or Closed (automatically set when a submission limit or expiry date is reached).

While a form is in Draft, edit it freely — nothing has been recorded against it yet, so there's no history to preserve. The moment you Publish, the current question set, rules, and theme are frozen into a version, and every submission from then on is tied to that exact version.

If you edit a published form's structure afterward (add, remove, or change a question or rule) and publish again, that creates a new version. Submissions collected under the old version keep pointing at it, so they still display and export correctly even though the live form has moved on. Submissions are never silently reinterpreted against a newer version of the form.

Archiving a form stops new submissions without deleting anything — use it when a program has ended but you still need the historical data. Deleting is different and is not reversible from the form list; archiving is almost always the safer choice when in doubt.`,
  },
  {
    id: 'form-apps-basics',
    title: 'What is a Form App?',
    tags: ['form app', 'data app', 'longitudinal', 'subject', 'record'],
    body: `A single form captures one snapshot in time. A Form App is for tracking something over time — a student, a household, a school — across multiple visits, forms, or check-ins.

A Form App is built on a Subject Type (the kind of thing you're tracking, e.g. "Student"), and its actual records are Subjects (one specific student). A Form App then strings together one or more Steps, where each step is a form. A step can be filled once per subject ever (registration, typically), once per subject per reporting period (a monthly check-in), or once per sitting.

Use a Form App instead of a plain form whenever the real question is "how has this person/place/thing changed across multiple visits" rather than "what did this one submission say." A plain form has no concept of "the same respondent's previous answer" — a Form App does, through its Subject.`,
  },
  {
    id: 'form-app-periods',
    title: 'Reporting periods in Form Apps',
    tags: ['period', 'recurring', 'monthly report', 'cadence', 'grace period'],
    body: `Some Form Apps have no concept of a reporting window at all — a step can be filled whenever the app is open. Others need a cadence: "one report per subject, per month."

That's what a Form App's period mode controls. Fixed periods have specific, pre-defined windows; Recurring periods generate on a repeating cadence (e.g. monthly) with configurable grace days (how late a report can arrive and still count for the period it was due) and backfill rules (whether a missed period can be filled in after the fact).

A step whose scope is "per subject, per period" will only accept one submission per subject within a given period — a second attempt either edits the existing one or is rejected, depending on how the step is configured. This is what actually enforces "one monthly check-in per household," not the respondent's own discipline about not double-submitting.`,
  },
  {
    id: 'choice-lists',
    title: 'Choice lists and cascading dropdowns',
    tags: [
      'dropdown options',
      'choice list',
      'cascading',
      'state district',
      'lookup',
    ],
    body: `Instead of retyping the same set of options ("all Indian states," "all districts in Punjab") into every question that needs them, define them once as a Choice List and point any Dropdown, Single Choice, or Multi Choice question at it.

Choice lists can cascade — a District list whose items are children of a State list, so picking a state narrows the district options to just that state's districts. India's states and districts are provided platform-wide out of the box; anything your organization needs beyond that, you create as your own choice list, and it's private to your organization.

Choice list items can also carry extra data beyond their label — a rule can look up that extra data (for example, auto-filling a school's official code once someone picks the school by name from a dropdown), so a respondent never has to type a code they'd likely get wrong.`,
  },
  {
    id: 'roles-and-permissions',
    title: 'Roles: Admin, Editor, Viewer',
    tags: ['permissions', 'role', 'access', 'who can', 'member'],
    body: `Every person in your organization has one of three roles, and a role hierarchy applies: Admin includes everything Editor can do, and Editor includes everything Viewer can do.

Viewer: can see forms and submissions, and export data. Cannot change anything.

Editor: everything a Viewer can do, plus creating and editing forms, rules, and Form Apps.

Admin: everything an Editor can do, plus managing organization members and their roles, and organization-wide settings.

A person can belong to more than one organization with a different role in each — being an Editor in one program doesn't grant any access in another. Ask your organization's Admin if you need a role change.`,
  },
  {
    id: 'exporting-data',
    title: 'Exporting form data',
    tags: ['export', 'csv', 'download', 'download responses'],
    body: `Any Viewer or above can export a form's submissions. Small exports return immediately; larger ones run as a background job you can watch progress on and download once it finishes, rather than holding the page open.

You can narrow an export by date range, submission status, or a free-text search before running it, so you're not always exporting the entire history of a long-running form.`,
  },
  {
    id: 'troubleshooting-publish-errors',
    title: 'Why won’t my form publish?',
    tags: ['publish error', 'cycle', 'error publishing', "can't publish"],
    body: `Publishing runs a check over every rule on the form before it's allowed to go live, so a broken rule set can never reach respondents. Two common reasons a publish is rejected:

A circular dependency — rule A's calculation depends on rule B's result, and rule B depends back on rule A. There's no valid order to evaluate them in, so the platform refuses to publish until the cycle is broken.

Exceeding the complexity budget — an extremely large or deeply chained set of rules on one form. This is rare in practice; if you hit it, the form usually benefits from being split rather than further optimized.

If you're not sure which rule is causing a publish error, describe the situation to the help bot and it can walk through your form's current rules and point at the specific one.`,
  },
];
