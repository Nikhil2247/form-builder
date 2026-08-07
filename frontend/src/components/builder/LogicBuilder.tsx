'use client';

import React from 'react';
import { ArrowRight, GitBranch, Plus, Trash2 } from 'lucide-react';
import { FormConfig, LogicRule, LogicOperator, LogicAction } from '@/types/form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { generateId } from '@/lib/utils';
import { PanelSection } from './panel-primitives';

/**
 * Conditional logic canvas.
 *
 * ── What changed and why ───────────────────────────────────────────────────
 * Every colour in this file used to be a literal Tailwind palette class —
 * `bg-white`, `text-slate-900`, `border-slate-200`, `text-indigo-600`,
 * `text-rose-500`, plus `dark:` variants hand-written for each one. None of
 * them were design tokens, so:
 *
 *   • The panel did not follow the app's theme. It was a white card on a page
 *     that is `bg-muted/25`, in a palette (`slate`/`indigo`) the rest of the
 *     product does not use.
 *   • Dark mode was maintained by hand and drifted — `hover:bg-rose-50` had no
 *     dark variant at all, so the delete button flashed near-white on hover.
 *   • The selects and the value field were bare `<select>`/`<input>` elements
 *     with their own hardcoded sizing, so they did not match the height, focus
 *     ring, or disabled treatment of controls anywhere else.
 *
 * It is now built from `PanelSection` and the shared UI components, at the same
 * density as the settings panel, and introduces no colour of its own.
 */

interface LogicBuilderProps {
  form: FormConfig;
  setForm: React.Dispatch<React.SetStateAction<FormConfig>>;
}

const OPERATORS: Array<{ label: string; value: LogicOperator }> = [
  { label: 'is equal to', value: 'EQUALS' },
  { label: 'is not equal to', value: 'NOT_EQUALS' },
  { label: 'contains', value: 'CONTAINS' },
  { label: 'is greater than', value: 'GREATER_THAN' },
  { label: 'is less than', value: 'LESS_THAN' },
  { label: 'has any answer', value: 'IS_FILLED' },
];

const ACTIONS: Array<{ label: string; value: LogicAction }> = [
  { label: 'Show', value: 'SHOW' },
  { label: 'Hide', value: 'HIDE' },
];

export function LogicBuilder({ form, setForm }: LogicBuilderProps) {
  const canAddRule = form.questions.length >= 2;

  const handleAddRule = () => {
    if (!canAddRule) return;
    const newRule: LogicRule = {
      id: generateId('logic'),
      triggerQuestionId: form.questions[0].id,
      operator: 'EQUALS',
      value: '',
      action: 'SHOW',
      targetQuestionId: form.questions[1].id,
    };
    setForm((prev) => ({ ...prev, logic: [...prev.logic, newRule] }));
  };

  const handleUpdateRule = (updated: LogicRule) => {
    setForm((prev) => ({
      ...prev,
      logic: prev.logic.map((r) => (r.id === updated.id ? updated : r)),
    }));
  };

  const handleDeleteRule = (id: string) => {
    setForm((prev) => ({ ...prev, logic: prev.logic.filter((r) => r.id !== id) }));
  };

  return (
    // Matches the build canvas exactly — same max width, same padding, same
    // vertical rhythm — so switching views does not shift the page under you.
    <div className="mx-auto max-w-3xl space-y-5 p-4 pb-24 sm:p-6 lg:p-8">
      <PanelSection
        title="Conditional logic"
        description="Show or hide questions based on what the respondent has already answered."
        action={
          <Button size="sm" onClick={handleAddRule} disabled={!canAddRule} className="gap-1.5">
            <Plus className="size-3.5" />
            Add rule
          </Button>
        }
      />

      {form.logic.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-border-strong bg-card p-10 text-center">
          <GitBranch className="mx-auto size-7 text-muted-foreground" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-semibold">No logic rules yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {canAddRule
                ? 'Add a rule to reveal or hide a question depending on an earlier answer — for example, ask why only when a rating is below 7.'
                : 'Add at least two questions to this form before you can connect them with a rule.'}
            </p>
          </div>
          {canAddRule && (
            <Button variant="outline" size="sm" onClick={handleAddRule} className="gap-1.5">
              <Plus className="size-3.5" />
              Create the first rule
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {form.logic.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={index}
              questions={form.questions}
              onChange={handleUpdateRule}
              onDelete={() => handleDeleteRule(rule.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RuleCard({
  rule,
  index,
  questions,
  onChange,
  onDelete,
}: {
  rule: LogicRule;
  index: number;
  questions: FormConfig['questions'];
  onChange: (rule: LogicRule) => void;
  onDelete: () => void;
}) {
  const trigger = questions.find((q) => q.id === rule.triggerQuestionId);
  const hasOptions = !!trigger?.options?.length;
  // "has any answer" tests for presence, so there is nothing to compare against.
  const needsValue = rule.operator !== 'IS_FILLED';

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <span className="tabular text-xs font-semibold text-muted-foreground">
          Rule {index + 1}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={`Delete rule ${index + 1}`}
          title="Delete rule"
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* ── Condition ───────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          When
        </span>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
          <NativeSelect
            className="w-full"
            aria-label="Trigger question"
            value={rule.triggerQuestionId}
            onChange={(e) => onChange({ ...rule, triggerQuestionId: e.target.value, value: '' })}
          >
            {questions.map((q) => (
              <NativeSelectOption key={q.id} value={q.id}>
                {q.label || 'Untitled question'}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          <NativeSelect
            className="w-full"
            aria-label="Condition"
            value={rule.operator}
            onChange={(e) => onChange({ ...rule, operator: e.target.value as LogicOperator })}
          >
            {OPERATORS.map((op) => (
              <NativeSelectOption key={op.value} value={op.value}>
                {op.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          {needsValue ? (
            hasOptions ? (
              <NativeSelect
                className="w-full"
                aria-label="Value to compare against"
                value={rule.value}
                onChange={(e) => onChange({ ...rule, value: e.target.value })}
              >
                <NativeSelectOption value="">Choose an option…</NativeSelectOption>
                {trigger?.options?.map((option) => (
                  <NativeSelectOption key={option.id} value={option.label}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Input
                value={rule.value}
                onChange={(e) => onChange({ ...rule, value: e.target.value })}
                aria-label="Value to compare against"
                placeholder="Value"
                className="h-8 text-sm"
              />
            )
          ) : (
            <div className="flex h-8 items-center text-xs text-muted-foreground">
              No value needed
            </div>
          )}
        </div>
      </div>

      {/* ── Action ──────────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ArrowRight className="size-3" />
          Then
        </span>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <NativeSelect
            className="w-full"
            aria-label="Action"
            value={rule.action}
            onChange={(e) => onChange({ ...rule, action: e.target.value as LogicAction })}
          >
            {ACTIONS.map((action) => (
              <NativeSelectOption key={action.value} value={action.value}>
                {action.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          <NativeSelect
            className="w-full"
            aria-label="Target question"
            value={rule.targetQuestionId || ''}
            onChange={(e) => onChange({ ...rule, targetQuestionId: e.target.value })}
          >
            <NativeSelectOption value="">Choose a question…</NativeSelectOption>
            {questions
              // A rule that targets its own trigger cannot settle: showing the
              // field changes the answer that decides whether to show it. The
              // API drops these on save, so do not offer them here either.
              .filter((q) => q.id !== rule.triggerQuestionId)
              .map((q) => (
                <NativeSelectOption key={q.id} value={q.id}>
                  {q.label || 'Untitled question'}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </div>

        {!rule.targetQuestionId && (
          <p className="text-xs text-destructive">
            Pick a question for this rule to act on, or it will be discarded when the form saves.
          </p>
        )}
      </div>
    </Card>
  );
}
