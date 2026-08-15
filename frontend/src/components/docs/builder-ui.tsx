import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { RULE_KIND_META } from '@/components/builder/rule-catalog';
import type { RuleKind } from '@/lib/rules';

/**
 * A faithful, static replica of the rule editor's own `RuleCard`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Built from the same `Card`, `Badge` and `NativeSelect` the real builder
 * renders with, and the same `RULE_KIND_META` table that supplies the kind
 * labels and hint copy inside the product — so a reader who comes here first
 * meets the identical chrome when they open the builder, not an artist's
 * impression of it. The selects are real `<select>` elements, just inert
 * (`disabled`), so the rounded border, chevron and padding are pixel-for-pixel
 * what `RulesBuilder.tsx` renders.
 *
 * Static on purpose — nothing here dispatches or edits anything. It exists to
 * be looked at, not operated.
 */
export function MockRuleCard({
  index = 1,
  kind,
  target,
  formula,
  message,
  children,
}: {
  index?: number;
  kind: RuleKind;
  /** The question key this rule acts on, e.g. `additional_id`. */
  target: string;
  /** One-line formula preview, exactly what `formatExpr()` would render. */
  formula: string;
  /** VALIDATE only — the message shown to the respondent. */
  message?: string;
  /** The expression editor area — usually an `<ExprBreakdown>`. */
  children?: React.ReactNode;
}) {
  const meta = RULE_KIND_META[kind];

  return (
    <Card className="space-y-3 p-4 sm:p-5" aria-hidden>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="tabular text-xs font-semibold text-muted-foreground">
            Rule {index}
          </span>
          <Badge variant="secondary" className="font-mono">
            {target}
          </Badge>
          <span className="truncate font-mono text-xs text-muted-foreground">{formula}</span>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Do this
        </span>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)]">
          <NativeSelect aria-label="Rule type" disabled defaultValue={kind}>
            <NativeSelectOption value={kind}>{meta.label}</NativeSelectOption>
          </NativeSelect>
          <NativeSelect aria-label="Target question" disabled defaultValue={target}>
            <NativeSelectOption value={target}>{target}</NativeSelectOption>
          </NativeSelect>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{meta.hint}</p>
      </div>

      {message !== undefined && (
        <div className="space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Message
          </span>
          <div className="h-8 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm text-foreground">
            {message}
          </div>
        </div>
      )}

      {children && (
        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {meta.exprLabel}
          </span>
          {children}
        </div>
      )}
    </Card>
  );
}

/**
 * One node of an expression tree, and what it does — the "describe each line"
 * view. Indentation mirrors nesting depth, the way the real expression editor
 * indents a nested operator under its parent.
 */
export function ExprBreakdown({
  lines,
}: {
  lines: Array<{ code: string; note: string; depth?: number }>;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {lines.map((line, i) => (
        <div
          key={i}
          className="flex flex-col gap-1.5 border-b border-border bg-card p-3 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4"
        >
          <code
            className="w-fit shrink-0 rounded bg-brand-blush px-2 py-1 font-mono text-xs font-medium text-brand-ember"
            style={{ marginLeft: `${(line.depth ?? 0) * 1.25}rem` }}
          >
            {line.code}
          </code>
          <p className="text-sm leading-relaxed text-muted-foreground">{line.note}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * A field as it sits on the builder canvas — label, type badge, and whatever
 * marks it out (required, calculated, source list). Used in walkthroughs to
 * show what an instruction like "add a Number field" actually produces,
 * without a screenshot to keep in sync with the real canvas.
 */
export function MockFieldRow({
  label,
  type,
  detail,
  badges = [],
}: {
  label: string;
  type: string;
  detail?: string;
  badges?: string[];
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-card p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {type}
          {detail ? ` · ${detail}` : ''}
        </p>
      </div>
      {badges.length > 0 && (
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {badges.map((badge) => (
            <Badge key={badge} variant="outline" className="text-[11px]">
              {badge}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A step as it sits in the app builder's step list — title, which role it
 * plays against the record type, and its cardinality. Mirrors the vocabulary
 * `docs/apps/record-types` and `docs/apps/steps` already use (Registers /
 * Attaches, Single / Repeatable) rather than the raw `subjectRole/mode` enum
 * names, so a reader who has read those pages meets the same words here.
 */
export function MockStepRow({
  index,
  title,
  role,
  cardinality,
  detail,
  badges = [],
}: {
  index: number;
  title: string;
  role: 'Registers' | 'Attaches' | 'None';
  cardinality: 'Single' | 'Repeatable';
  /** e.g. "once per record", "once per quarter", "optional" */
  detail?: string;
  badges?: string[];
}) {
  return (
    <div className="flex items-start gap-3.5 rounded-xl border border-border bg-card p-4">
      <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-blush text-xs font-semibold text-brand-ember">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <Badge variant="secondary" className="text-[11px]">
            {role}
          </Badge>
          <Badge variant="outline" className="text-[11px]">
            {cardinality}
          </Badge>
          {badges.map((badge) => (
            <Badge key={badge} variant="outline" className="text-[11px]">
              {badge}
            </Badge>
          ))}
        </div>
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

/** Groups a run of `MockFieldRow`s into one canvas-like stack. */
export function MockCanvas({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="space-y-3 rounded-2xl border border-dashed border-border-strong bg-muted/20 p-4 sm:p-5">
      {title && (
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
      )}
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}
