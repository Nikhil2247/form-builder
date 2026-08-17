'use client';

import React from 'react';
import { AlertTriangle, CheckCircle2, Plus, Sigma, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { FEATURES, useFeature } from '@/hooks/use-features';
import { compileRules, RULE_KINDS, type CompileError, type FormRule, type RuleKind } from '@/lib/rules';
import { generateId } from '@/lib/utils';
import type { FormConfig } from '@/types/form';

import { ExpressionEditor } from './ExpressionEditor';
import { PanelSection } from './panel-primitives';
import {
  blankRule,
  deriveQuestionKeys,
  formatExpr,
  RULE_KIND_META,
  RULE_TEMPLATES,
  type QuestionKeyRow,
} from './rule-catalog';

/**
 * Rules canvas — calculations, visibility, requiredness and validation.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The counterpart to `LogicBuilder`, and deliberately built the same way: the
 * same page container, the same `PanelSection` masthead, the same card density
 * and the same control sizes, so moving between the two does not feel like
 * moving between two products.
 *
 * ── Why validation is live ─────────────────────────────────────────────────
 * `compileRules` is not a second, friendlier copy of the publish check — it is
 * the same function the server runs at publish, imported from the mirrored
 * engine. Running it on every edit means the panel's verdict and the publish
 * endpoint's verdict cannot drift: if this says the set compiles, it compiles.
 *
 * That also buys the errors nothing else could produce. A dependency cycle
 * (`age → band → age`) is a property of the whole rule set, not of any one
 * rule, and no amount of per-field validation would find it. It arrives here as
 * a form-level error with the cycle spelled out.
 *
 * ── Why the whole set recompiles per keystroke ─────────────────────────────
 * Because it is cheap and it is the only correct unit. The compiler is a walk
 * over at most 200 trees of at most 256 nodes with no I/O, and cycle detection
 * needs every CALCULATE rule anyway. Memoised on the rules array identity, so
 * typing in an unrelated part of the builder does not re-run it.
 */

interface RulesBuilderProps {
  form: FormConfig;
  setForm: React.Dispatch<React.SetStateAction<FormConfig>>;
  /**
   * Whether this form is bound to a subject type. Cross-form `ref` nodes are
   * rejected by the compiler without one, so the node type is disabled rather
   * than offered and then refused at publish.
   */
  allowReferences: boolean;
}

/**
 * Feature gate. Rendering nothing — not a placeholder, not an upsell — is
 * deliberate: the parent decides where this panel sits, and an org without the
 * flag should see the builder exactly as it was before rules existed.
 */
export function RulesBuilder(props: RulesBuilderProps) {
  const enabled = useFeature(FEATURES.FORM_RULES);
  if (!enabled) return null;
  return <RulesPanel {...props} />;
}

function RulesPanel({ form, setForm, allowReferences }: RulesBuilderProps) {
  const rules = React.useMemo(() => form.rules ?? [], [form.rules]);

  // Keys, not ids, are how rules address questions — and a question that has
  // not been saved yet has no key, so it is derived here with the server's own
  // algorithm rather than left un-addressable until the next reload.
  const fields: QuestionKeyRow[] = React.useMemo(
    () => deriveQuestionKeys(form.questions ?? []),
    [form.questions],
  );

  const knownKeys = React.useMemo(() => fields.map((f) => f.key), [fields]);

  const result = React.useMemo(
    () => compileRules(rules, { knownKeys, allowReferences }),
    [rules, knownKeys, allowReferences],
  );

  // Memoised so the empty-array branch keeps a stable identity — otherwise a
  // clean compile allocates a new `[]` per render and every downstream memo
  // recomputes for nothing.
  const errors: CompileError[] = React.useMemo(
    () => (result.ok ? [] : result.errors),
    [result],
  );

  const errorsByRule = React.useMemo(() => {
    const map = new Map<string, string[]>();
    for (const error of errors) {
      if (!error.ruleId) continue;
      map.set(error.ruleId, [...(map.get(error.ruleId) ?? []), error.message]);
    }
    return map;
  }, [errors]);

  // Cycles and over-budget rule sets belong to the form, not to a rule, and
  // have nowhere to render inline.
  const formErrors = errors.filter((error) => !error.ruleId).map((error) => error.message);

  const setRules = React.useCallback(
    (next: FormRule[]) => setForm((prev) => ({ ...prev, rules: next })),
    [setForm],
  );

  const canAddRule = fields.length > 0;

  const handleAdd = () => {
    if (!canAddRule) return;
    setRules([...rules, blankRule(generateId('rule'), fields)]);
  };

  const handleTemplate = (templateId: string) => {
    const template = RULE_TEMPLATES.find((t) => t.id === templateId);
    if (!template || !canAddRule) return;

    setRules([
      ...rules,
      {
        id: generateId('rule'),
        kind: template.kind,
        // CALCULATE writes to its target, so it must not default to a question
        // the template already reads from — that is an instant self-reference.
        target: (template.kind === 'CALCULATE' ? fields[fields.length - 1] : fields[0])?.key ?? '',
        expr: template.build(fields),
        ...(template.message ? { message: template.message } : {}),
      },
    ]);
  };

  const handleUpdate = (updated: FormRule) =>
    setRules(rules.map((rule) => (rule.id === updated.id ? updated : rule)));

  const handleDelete = (id: string) => setRules(rules.filter((rule) => rule.id !== id));

  return (
    // Matches the logic canvas — same max width, same rhythm. The page owns the
    // bottom padding so the two panels stack without a gap between them.
    <div className="mx-auto max-w-3xl space-y-5 px-4 sm:px-6 lg:px-8">
      <PanelSection
        title="Rules"
        description="Calculate a value, show or require a question based on an earlier answer, or reject a submission. Checked live, the same way publishing checks it, so a green tick here means it will publish."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              size="sm"
              className="w-full sm:w-52"
              aria-label="Start from a template"
              value=""
              disabled={!canAddRule}
              onChange={(e) => {
                handleTemplate(e.target.value);
                // A template is an action, not a selection — reset so the same
                // one can be picked twice in a row.
                e.target.value = '';
              }}
            >
              <NativeSelectOption value="">Start from a template…</NativeSelectOption>
              {RULE_KINDS.map((kind) => {
                const members = RULE_TEMPLATES.filter((t) => t.kind === kind);
                if (members.length === 0) return null;
                return (
                  <NativeSelectOptGroup key={kind} label={RULE_KIND_META[kind].label}>
                    {members.map((template) => (
                      <NativeSelectOption key={template.id} value={template.id}>
                        {template.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelectOptGroup>
                );
              })}
            </NativeSelect>

            <Button size="sm" onClick={handleAdd} disabled={!canAddRule} className="gap-1.5">
              <Plus className="size-3.5" />
              Add rule
            </Button>
          </div>
        }
      />

      {rules.length > 0 && (
        <CompileStatus ok={result.ok} ruleCount={rules.length} formErrors={formErrors} />
      )}

      {rules.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-border-strong bg-card p-10 text-center">
          <Sigma className="mx-auto size-7 text-muted-foreground" strokeWidth={1.5} />
          <div>
            <p className="text-sm font-semibold">No rules yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {canAddRule
                ? 'A rule derives an answer from other answers — an age from a date of birth, a total from two amounts — or decides when a question appears, becomes mandatory, or blocks the submission.'
                : 'Add at least one question to this form before you can write a rule about it.'}
            </p>
          </div>
          {canAddRule && (
            <Button variant="outline" size="sm" onClick={handleAdd} className="gap-1.5">
              <Plus className="size-3.5" />
              Create the first rule
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              index={index}
              fields={fields}
              allowReferences={allowReferences}
              errors={errorsByRule.get(rule.id) ?? []}
              onChange={handleUpdate}
              onDelete={() => handleDelete(rule.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The verdict strip.
 *
 * Green is worth as much as red here: an author writing a formula has no other
 * way to know the tree is complete, and "this will publish" said continuously
 * is what makes the nested editor feel safe to experiment in.
 */
function CompileStatus({
  ok,
  ruleCount,
  formErrors,
}: {
  ok: boolean;
  ruleCount: number;
  formErrors: string[];
}) {
  if (ok) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5">
        <CheckCircle2 className="size-4 shrink-0 text-success" strokeWidth={1.75} />
        <p className="text-xs text-muted-foreground">
          {ruleCount === 1 ? 'This rule is set up correctly' : `All ${ruleCount} rules are set up correctly`}{' '}
          and will publish.
        </p>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-destructive" strokeWidth={1.75} />
        <p className="text-xs font-semibold text-destructive">
          These rules have a problem and will not publish until it is fixed.
        </p>
      </div>
      {formErrors.length > 0 && (
        <ul className="space-y-1 pl-6">
          {formErrors.map((message, index) => (
            <li key={index} className="text-xs leading-relaxed text-destructive">
              {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleCard({
  rule,
  index,
  fields,
  allowReferences,
  errors,
  onChange,
  onDelete,
}: {
  rule: FormRule;
  index: number;
  fields: QuestionKeyRow[];
  allowReferences: boolean;
  errors: string[];
  onChange: (rule: FormRule) => void;
  onDelete: () => void;
}) {
  const meta = RULE_KIND_META[rule.kind] ?? RULE_KIND_META.SHOW;
  const messageId = `${rule.id}-message`;

  const changeKind = (kind: RuleKind) => {
    const next: FormRule = { ...rule, kind };
    // The message is meaningless outside VALIDATE and its absence is what the
    // compiler checks for, so it is added and dropped with the kind.
    if (kind === 'VALIDATE') next.message = rule.message ?? '';
    else delete next.message;
    onChange(next);
  };

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="tabular text-xs font-semibold text-muted-foreground">
            Rule {index + 1}
          </span>
          <Badge variant={errors.length > 0 ? 'destructive' : 'secondary'} className="font-mono">
            {rule.target || 'no question chosen'}
          </Badge>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {formatExpr(rule.expr)}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={`Delete rule ${index + 1}`}
          title="Delete rule"
          className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* ── What the rule does, and to which question ────────────────────── */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Do this
        </span>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)]">
          <NativeSelect
            className="w-full"
            aria-label={`Rule ${index + 1} type`}
            value={rule.kind}
            onChange={(e) => changeKind(e.target.value as RuleKind)}
          >
            {RULE_KINDS.map((kind) => (
              <NativeSelectOption key={kind} value={kind}>
                {RULE_KIND_META[kind].label}
              </NativeSelectOption>
            ))}
          </NativeSelect>

          <NativeSelect
            className="w-full"
            aria-label={`Rule ${index + 1} target question`}
            value={rule.target}
            onChange={(e) => onChange({ ...rule, target: e.target.value })}
          >
            <NativeSelectOption value="">Choose a question…</NativeSelectOption>
            {/* A target that no longer resolves stays selected so the author can
                see what broke; the compiler reports it below. */}
            {rule.target && !fields.some((f) => f.key === rule.target) && (
              <NativeSelectOption value={rule.target}>{rule.target} (missing)</NativeSelectOption>
            )}
            {fields.map((field) => (
              <NativeSelectOption key={field.id} value={field.key}>
                {field.label} · {field.key}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{meta.hint}</p>
      </div>

      {/* ── The message a rejected submission shows ──────────────────────── */}
      {rule.kind === 'VALIDATE' && (
        <div className="space-y-1.5">
          <label
            htmlFor={messageId}
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Message
          </label>
          <Input
            id={messageId}
            value={rule.message ?? ''}
            onChange={(e) => onChange({ ...rule, message: e.target.value })}
            placeholder="Tell the respondent what to fix"
            className="h-8 text-sm"
          />
        </div>
      )}

      {/* ── The expression ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {meta.exprLabel}
        </span>
        <ExpressionEditor
          node={rule.expr}
          onChange={(expr) => onChange({ ...rule, expr })}
          fields={fields}
          allowReferences={allowReferences}
        />
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 border-t border-destructive/30 pt-3">
          {errors.map((message, i) => (
            <li key={i} className="text-xs leading-relaxed text-destructive">
              {message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
