'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { AlertCircle, Calculator, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { FormQuestion } from '@/types/form';

import { ChoiceListField } from './ChoiceListField';
import { FileUploader } from './FormRunnerUpload';

/**
 * `react-signature-canvas` is ~40 KiB of drawing code that only a SIGNATURE
 * question can use, and most forms have none — so it is fetched when such a
 * question first renders rather than shipped to every respondent. `ssr: false`
 * because the pad measures a real <canvas> on mount and has no server render
 * worth producing; the reserved-height placeholder below keeps the surrounding
 * form from jumping when it arrives.
 */
const SignatureControl = dynamic(() => import('./SignatureField'), {
  ssr: false,
  loading: () => (
    <div
      className="h-[264px] max-w-[400px] animate-pulse rounded-md border border-border bg-muted"
      role="status"
      aria-label="Loading signature pad"
    />
  ),
});

/**
 * One question on the public form.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Split out of `FormRunner` so the orchestration (pages, rules, submit) and the
 * per-control markup stop competing for the same file. The accessibility work
 * lives here, because it is per-control by nature.
 *
 * ── What every control now guarantees ──────────────────────────────────────
 *   • a real label/control association (`id` + `htmlFor`, or a
 *     fieldset/legend, or `aria-labelledby` on a composite widget);
 *   • `aria-invalid` and `aria-describedby` pointing at the description and
 *     the error, so a screen reader announces the failure with the field
 *     rather than leaving it as an unattached red line;
 *   • the author's own `validation` constraints on the element — `maxLength`,
 *     `min`, `max`, `step`, `pattern`, `accept` — none of which reached the
 *     DOM before, so a "max 500 chars" question accepted 50,000.
 *
 * ── Calculated questions ───────────────────────────────────────────────────
 * A question owned by a CALCULATE rule is rendered as a read-only value, not an
 * input. That is the whole point of the rules engine and it has never been
 * visible to a respondent: the field used to render as an ordinary empty box
 * whose contents the API discarded and recomputed. `aria-live="polite"` means
 * the recomputed value is announced when its inputs change.
 */

export interface FormRunnerFieldProps {
  question: FormQuestion;
  /** The effective value — for a calculated question this is the derived one. */
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  /** Own `required` flag OR a REQUIRE rule; never true for a calculated field. */
  required: boolean;
  /** Owned by a CALCULATE rule: show the derived value, do not accept input. */
  calculated: boolean;
  /** Field-level message from client validation or the API. */
  error?: string;
  /** Messages from triggered VALIDATE rules. */
  violations?: string[];
  /** Errors are held back until the respondent has engaged with the field. */
  showProblems: boolean;
  formId: string;
  /**
   * 1-based position among the answerable questions on this step.
   *
   * Shown as a small index beside the label. On a long form this is the
   * cheapest possible orientation aid — it tells a respondent where they are
   * and gives support staff something to refer to on the phone.
   */
  index?: number;
  /** Public slug, needed to fetch options for a list-backed question. */
  formSlug?: string;
  /** Builder preview fallback for a list-backed question — see `ChoiceListField`. */
  orgId?: string;
  /** The parent question's current answer, when this one cascades. */
  parentValue?: string;
  /** The parent question's label, for the "choose X first" message. */
  parentLabel?: string;
  className?: string;
}

/** Types whose control is a single labelled element rather than a group. */
const SINGLE_CONTROL_TYPES = new Set([
  'SHORT_TEXT',
  'LONG_TEXT',
  'NUMBER',
  'EMAIL',
  'PHONE',
  'URL',
  'DROPDOWN',
  'DATE',
  'SLIDER',
  'FILE_UPLOAD',
]);

const AUTOCOMPLETE_BY_TYPE: Partial<Record<FormQuestion['type'], string>> = {
  EMAIL: 'email',
  PHONE: 'tel',
  URL: 'url',
};

const INPUT_MODE_BY_TYPE: Partial<Record<FormQuestion['type'], 'numeric' | 'decimal' | 'tel' | 'url' | 'email'>> =
  {
    NUMBER: 'decimal',
    PHONE: 'tel',
    URL: 'url',
    EMAIL: 'email',
  };

/** Human-readable rendering of a calculated result. */
function formatCalculated(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v ?? '')).filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return null;
  return String(value);
}

export function FormRunnerField({
  question: q,
  value,
  onChange,
  onBlur,
  required,
  calculated,
  error,
  violations,
  showProblems,
  formId,
  index,
  formSlug,
  orgId,
  parentValue,
  parentLabel,
  className,
}: FormRunnerFieldProps) {
  const controlId = `q-${q.id}`;
  const labelId = `${controlId}-label`;
  const descriptionId = q.description ? `${controlId}-description` : undefined;
  const errorId = `${controlId}-error`;
  const hintId = `${controlId}-hint`;

  const problems = showProblems
    ? [...(error ? [error] : []), ...(violations ?? [])]
    : [];
  const hasProblem = problems.length > 0;

  const maxLength = q.validation?.maxLength;
  const counterVisible =
    !calculated && typeof maxLength === 'number' && (q.type === 'LONG_TEXT' || q.type === 'SHORT_TEXT');
  const currentLength = typeof value === 'string' ? value.length : 0;

  // A composite widget (radiogroup, matrix, checkbox list) is named by the
  // question text via aria-labelledby; a single control is named by a real
  // <label for>. Getting this wrong is the difference between "Email address,
  // edit text" and "edit text".
  const isSingleControl = SINGLE_CONTROL_TYPES.has(q.type);

  const describedBy =
    [descriptionId, counterVisible ? hintId : undefined, hasProblem ? errorId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;

  const shared = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': hasProblem || undefined,
    'aria-required': required || undefined,
    onBlur,
  };

  return (
    <Card
      className={cn(
        // A slightly heavier left edge on error reads faster than a full ring
        // and does not fight the theme's own border colour.
        'bg-card p-5 transition-colors sm:p-6',
        hasProblem && 'border-destructive/60 ring-1 ring-destructive/40',
        className,
      )}
      data-question-id={q.id}
    >
      {/* The index sits in its own column so long labels wrap against a stable
          left edge instead of stepping around it. */}
      <div className="flex gap-3 sm:gap-4">
        {typeof index === 'number' && (
          <span
            aria-hidden
            className="tabular mt-0.5 hidden w-6 shrink-0 select-none text-sm font-semibold text-muted-foreground sm:block"
          >
            {index}.
          </span>
        )}

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3">
            {isSingleControl ? (
              <Label
                id={labelId}
                htmlFor={controlId}
                className="text-[0.9375rem] font-semibold leading-snug text-foreground"
              >
                {q.label}
                {required && (
                  <span className="ml-1 text-destructive" aria-hidden>
                    *
                  </span>
                )}
                {/* The asterisk is decorative; this is what is announced. */}
                {required && <span className="sr-only"> (required)</span>}
              </Label>
            ) : (
              <span
                id={labelId}
                className="text-[0.9375rem] font-semibold leading-snug text-foreground"
              >
                {q.label}
                {required && (
                  <span className="ml-1 text-destructive" aria-hidden>
                    *
                  </span>
                )}
                {required && <span className="sr-only"> (required)</span>}
              </span>
            )}

            <div className="flex shrink-0 items-center gap-1.5">
              {calculated && (
                <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Calculator className="size-2.5" aria-hidden />
                  Auto
                </span>
              )}
              {(q.points || 0) > 0 && (
                <span className="whitespace-nowrap rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                  {q.points} pts
                </span>
              )}
            </div>
          </div>

          {q.description && (
            <p id={descriptionId} className="text-[0.8125rem] leading-relaxed text-muted-foreground">
              {q.description}
            </p>
          )}

          <div>
            {calculated ? (
              <CalculatedValue value={value} labelId={labelId} describedBy={describedBy} />
            ) : (
              <QuestionControl
                q={q}
                value={value}
                onChange={onChange}
                shared={shared}
                labelId={labelId}
                hasProblem={hasProblem}
                formId={formId}
                formSlug={formSlug}
                orgId={orgId}
                parentValue={parentValue}
                parentLabel={parentLabel}
                required={required}
              />
            )}
          </div>

          {counterVisible && (
            <p
              id={hintId}
              className={cn(
                'text-right text-[0.6875rem] tabular text-muted-foreground',
                currentLength > (maxLength ?? 0) && 'font-semibold text-destructive',
              )}
            >
              {currentLength} / {maxLength}
            </p>
          )}

          {hasProblem && (
            <div id={errorId} role="alert" className="space-y-1">
              {problems.map((message, problemIndex) => (
                <p
                  key={problemIndex}
                  className="flex items-start gap-1.5 text-xs font-medium text-destructive"
                >
                  <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden />
                  <span>{message}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * A derived value, shown rather than asked for.
 *
 * Not a disabled `<input>`: a disabled input is skipped by screen readers and
 * is not reachable by keyboard, so the respondent would have no way to hear a
 * value that is part of their answer. This is a readable region that announces
 * itself when it changes.
 */
function CalculatedValue({
  value,
  labelId,
  describedBy,
}: {
  value: unknown;
  labelId: string;
  describedBy?: string;
}) {
  const text = formatCalculated(value);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      className={cn(
        'flex min-h-9 max-w-md items-center rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm',
        text ? 'font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      {text ?? (
        <>
          <span aria-hidden>—</span>
          <span className="sr-only">
            No value yet. This is calculated from your other answers.
          </span>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls
// ─────────────────────────────────────────────────────────────────────────────

interface ControlProps {
  q: FormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  shared: Record<string, unknown>;
  labelId: string;
  hasProblem: boolean;
  formId: string;
  formSlug?: string;
  orgId?: string;
  parentValue?: string;
  parentLabel?: string;
  required: boolean;
}

function QuestionControl({
  q,
  value,
  onChange,
  shared,
  labelId,
  hasProblem,
  formId,
  formSlug,
  orgId,
  parentValue,
  parentLabel,
  required,
}: ControlProps) {
  const v = q.validation ?? {};

  // A list-backed question takes precedence over every static renderer below:
  // its `options` array is empty by design, so SINGLE_CHOICE, MULTI_CHOICE and
  // DROPDOWN would each render an empty control.
  if (q.optionsSource?.kind === 'CHOICE_LIST') {
    return (
      <ChoiceListField
        question={q}
        value={value}
        onChange={onChange}
        onBlur={shared.onBlur as () => void}
        formSlug={formSlug}
        orgId={orgId}
        parentValue={parentValue}
        parentLabel={parentLabel}
        controlId={shared.id as string}
        labelId={labelId}
        describedBy={shared['aria-describedby'] as string | undefined}
        invalid={hasProblem}
        required={required}
      />
    );
  }

  switch (q.type) {
    case 'SHORT_TEXT':
    case 'EMAIL':
    case 'PHONE':
    case 'URL':
    case 'NUMBER':
      return (
        <Input
          {...shared}
          type={q.type === 'NUMBER' ? 'number' : q.type === 'EMAIL' ? 'email' : 'text'}
          placeholder={q.placeholder || 'Your answer...'}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          onChange={(e) => onChange(e.target.value)}
          // The author's constraints, on the element. None of these reached the
          // DOM before, so every one of them was server-only.
          maxLength={q.type === 'NUMBER' ? undefined : v.maxLength}
          minLength={q.type === 'NUMBER' ? undefined : v.minLength}
          min={q.type === 'NUMBER' ? v.min : undefined}
          max={q.type === 'NUMBER' ? v.max : undefined}
          pattern={q.type === 'NUMBER' ? undefined : v.pattern}
          inputMode={INPUT_MODE_BY_TYPE[q.type]}
          autoComplete={AUTOCOMPLETE_BY_TYPE[q.type] ?? 'off'}
          className="max-w-md bg-background"
        />
      );

    case 'LONG_TEXT':
      return (
        <Textarea
          {...shared}
          placeholder={q.placeholder || 'Your detailed answer...'}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          maxLength={v.maxLength}
          minLength={v.minLength}
          rows={4}
          className="max-w-2xl bg-background"
        />
      );

    case 'SINGLE_CHOICE':
      return (
        // A radio group must carry the question as its accessible name, or the
        // options are announced with no idea what they answer.
        <fieldset className="space-y-3" aria-describedby={shared['aria-describedby'] as string}>
          <legend className="sr-only">{q.label}</legend>
          <RadioGroup
            value={typeof value === 'string' ? value : ''}
            onValueChange={(next) => onChange(next)}
            aria-labelledby={labelId}
            aria-invalid={(shared['aria-invalid'] as boolean) || undefined}
            aria-required={(shared['aria-required'] as boolean) || undefined}
            className="space-y-3"
          >
            {q.options?.map((opt) => (
              <div key={opt.id} className="flex items-center space-x-3">
                <RadioGroupItem value={opt.label} id={`r-${q.id}-${opt.id}`} />
                <Label htmlFor={`r-${q.id}-${opt.id}`} className="cursor-pointer font-normal">
                  {opt.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
      );

    case 'MULTI_CHOICE': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset
          className="space-y-3"
          aria-describedby={shared['aria-describedby'] as string}
          aria-invalid={(shared['aria-invalid'] as boolean) || undefined}
        >
          <legend className="sr-only">
            {q.label} — choose one or more
          </legend>
          {q.options?.map((opt) => (
            <div key={opt.id} className="flex items-center space-x-3">
              <Checkbox
                id={`c-${q.id}-${opt.id}`}
                checked={selected.includes(opt.label)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selected, opt.label]
                      : selected.filter((item) => item !== opt.label),
                  )
                }
              />
              <Label htmlFor={`c-${q.id}-${opt.id}`} className="cursor-pointer font-normal">
                {opt.label}
              </Label>
            </div>
          ))}
        </fieldset>
      );
    }

    case 'DROPDOWN':
      return (
        <select
          {...shared}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Select an option...</option>
          {q.options?.map((opt) => (
            <option key={opt.id} value={opt.label}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case 'DATE':
      return (
        <Input
          {...shared}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-[200px] bg-background"
        />
      );

    case 'SLIDER': {
      // Previously rendered NOTHING: `SLIDER` was offered in both field
      // palettes, normalised server-side with min/max/step and validated on
      // submit, but the runner had no branch for it. A required slider made the
      // form impossible to submit.
      const min = q.sliderMin ?? 0;
      const max = q.sliderMax ?? 100;
      const step = q.sliderStep ?? 1;
      const current = typeof value === 'number' ? value : Number(value);
      const resolved = Number.isFinite(current) ? current : min;

      return (
        <div className="max-w-md space-y-2">
          <input
            {...shared}
            type="range"
            min={min}
            max={max}
            step={step}
            value={resolved}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-valuenow={resolved}
            aria-valuemin={min}
            aria-valuemax={max}
            className="w-full accent-[var(--primary)]"
          />
          <div className="tabular flex items-center justify-between text-xs text-muted-foreground">
            <span aria-hidden>{min}</span>
            <output htmlFor={shared.id as string} className="font-semibold text-foreground">
              {resolved}
            </output>
            <span aria-hidden>{max}</span>
          </div>
        </div>
      );
    }

    case 'STAR_RATING':
      return (
        <RatingGroup
          labelId={labelId}
          describedBy={shared['aria-describedby'] as string | undefined}
          value={typeof value === 'number' ? value : Number(value) || 0}
          onChange={onChange}
          options={[1, 2, 3, 4, 5]}
          renderOption={(star, isSelected) => (
            <Star
              size={32}
              className={isSelected ? 'text-yellow-400' : 'text-muted-foreground'}
              fill={isSelected ? 'currentColor' : 'none'}
              aria-hidden
            />
          )}
          optionLabel={(star) => `${star} star${star === 1 ? '' : 's'}`}
          // Stars are cumulative: picking 4 lights 1–4.
          isActive={(star, selected) => selected >= star}
          className="flex gap-2"
        />
      );

    case 'NPS':
      return (
        <RatingGroup
          labelId={labelId}
          describedBy={shared['aria-describedby'] as string | undefined}
          value={typeof value === 'number' ? value : Number.isFinite(Number(value)) ? Number(value) : -1}
          onChange={onChange}
          options={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
          renderOption={(n) => <span aria-hidden>{n}</span>}
          optionLabel={(n) => `${n} out of 10`}
          isActive={(n, selected) => selected === n}
          className="flex w-full max-w-2xl flex-wrap justify-between gap-2"
          optionClassName="size-10 rounded-md border text-sm font-semibold"
        />
      );

    case 'MATRIX':
      return <MatrixControl q={q} value={value} onChange={onChange} labelId={labelId} />;

    case 'FILE_UPLOAD':
      return (
        <FileUploader
          formId={formId}
          questionId={q.id}
          inputId={shared.id as string}
          describedBy={shared['aria-describedby'] as string | undefined}
          accept={q.validation?.allowedTypes}
          maxSizeMb={q.validation?.maxSizeMb}
          value={typeof value === 'string' ? value : ''}
          onChange={(fileId) => onChange(fileId)}
        />
      );

    case 'SIGNATURE':
      return (
        <SignatureControl
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          labelId={labelId}
          describedBy={shared['aria-describedby'] as string | undefined}
        />
      );

    case 'REPEATING_SECTION':
      return <RepeatingSectionControl q={q} value={value} onChange={onChange} />;

    default:
      return (
        <Input
          {...shared}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          className="max-w-md bg-background"
        />
      );
  }
}

/**
 * Star rating and NPS.
 *
 * Both were rows of unlabelled `<button>`s — announced as five identical empty
 * buttons, or as eleven bare digits with no group name and no selection state.
 * This is a proper radio group: one tab stop, arrow keys to move, Home/End to
 * jump, and every option carries its own name and checked state.
 */
function RatingGroup<T extends number>({
  labelId,
  describedBy,
  value,
  onChange,
  options,
  renderOption,
  optionLabel,
  isActive,
  className,
  optionClassName,
}: {
  labelId: string;
  describedBy?: string;
  value: number;
  onChange: (value: number) => void;
  options: T[];
  renderOption: (option: T, isSelected: boolean) => React.ReactNode;
  optionLabel: (option: T) => string;
  isActive: (option: T, selected: number) => boolean;
  className?: string;
  optionClassName?: string;
}) {
  const selectedIndex = options.findIndex((option) => option === value);
  // Roving tabindex: the group is one tab stop, not eleven.
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const move = (event: React.KeyboardEvent, index: number) => {
    const last = options.length - 1;
    let next: number | null = null;

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(index + 1, last);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;

    if (next === null) return;
    event.preventDefault();
    onChange(options[next]);
    const container = event.currentTarget.parentElement;
    (container?.children[next] as HTMLElement | undefined)?.focus();
  };

  return (
    <div role="radiogroup" aria-labelledby={labelId} aria-describedby={describedBy} className={className}>
      {options.map((option, index) => {
        const active = isActive(option, value);
        const selected = option === value;
        return (
          <button
            type="button"
            key={option}
            role="radio"
            aria-checked={selected}
            aria-label={optionLabel(option)}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(option)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              'transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              optionClassName ?? 'p-1',
              optionClassName &&
                (selected
                  ? 'scale-110 border-primary bg-primary text-primary-foreground shadow-md'
                  : 'border-input bg-background text-foreground hover:border-primary'),
            )}
          >
            {renderOption(option, active)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Likert / matrix grid.
 *
 * The cells used to be radios with `onChange={() => {}}` and selection driven
 * by a click handler on the `<td>` — inert to the keyboard and to assistive
 * technology, and with no accessible name anywhere, so a cell announced as an
 * unlabelled radio. Each row is now its own radio group named by the row
 * header, and each cell carries "row, column" as its name.
 */
function MatrixControl({
  q,
  value,
  onChange,
  labelId,
}: {
  q: FormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  labelId: string;
}) {
  const answers = (value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}) as Record<string, string>;

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border bg-background">
      <table className="w-full text-left text-sm" aria-labelledby={labelId}>
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th scope="col" className="min-w-[150px] border-r border-border p-3">
              <span className="sr-only">Item</span>
            </th>
            {q.matrixColumns?.map((col) => (
              <th
                key={col}
                scope="col"
                className="whitespace-nowrap p-3 text-center font-semibold text-muted-foreground"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {q.matrixRows?.map((row) => (
            <tr key={row} className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/30">
              <th
                scope="row"
                className="border-r border-border bg-muted/10 p-3 text-left font-medium text-foreground"
              >
                {row}
              </th>
              {q.matrixColumns?.map((col) => (
                <td key={col} className="p-3 text-center">
                  <input
                    type="radio"
                    name={`matrix-${q.id}-${row}`}
                    value={col}
                    checked={answers[row] === col}
                    aria-label={`${row}: ${col}`}
                    onChange={() => onChange({ ...answers, [row]: col })}
                    className="size-4 cursor-pointer accent-[var(--primary)]"
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Repeating section.
 *
 * Left broadly as it was, deliberately. `subQuestions` is currently stripped by
 * the API's `normalizeQuestions` and there is no authoring UI for it, so this
 * control is unreachable — making it type-aware belongs with the work that
 * makes repeat groups real, not here. The row controls are labelled properly so
 * that work starts from an accessible baseline.
 */
function RepeatingSectionControl({
  q,
  value,
  onChange,
}: {
  q: FormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const rows: Record<string, unknown>[] = Array.isArray(value)
    ? (value as Record<string, unknown>[])
    : [{}];

  const patch = (index: number, key: string, next: unknown) => {
    const copy = rows.map((row, i) => (i === index ? { ...row, [key]: next } : row));
    onChange(copy);
  };

  return (
    <div className="space-y-4">
      {rows.map((row, rowIndex) => (
        <fieldset key={rowIndex} className="relative rounded-md border border-border bg-muted/20 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {q.label} — item {rowIndex + 1}
          </legend>
          <div className="absolute right-2 top-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-destructive"
              aria-label={`Remove item ${rowIndex + 1}`}
              onClick={() => onChange(rows.filter((_, i) => i !== rowIndex))}
            >
              Remove
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 pt-2">
            {q.subQuestions?.map((subQ) => {
              const subId = `q-${q.id}-${rowIndex}-${subQ.id}`;
              return (
                <div key={subQ.id}>
                  <Label htmlFor={subId} className="mb-1 block text-sm font-medium">
                    {subQ.label}
                  </Label>
                  <Input
                    id={subId}
                    type={subQ.type === 'NUMBER' ? 'number' : subQ.type === 'EMAIL' ? 'email' : 'text'}
                    value={typeof row[subQ.id] === 'string' || typeof row[subQ.id] === 'number'
                      ? String(row[subQ.id])
                      : ''}
                    placeholder={subQ.placeholder || 'Enter value...'}
                    onChange={(e) => patch(rowIndex, subQ.id, e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, {}])}>
        + Add another
      </Button>
    </div>
  );
}
