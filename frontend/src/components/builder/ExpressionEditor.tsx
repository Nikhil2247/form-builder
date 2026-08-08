'use client';

import React from 'react';
import { Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { useForms } from '@/hooks/use-forms';
import { REF_WHEN_VALUES, type ExprNode, type RefWhen, type RuleValue } from '@/lib/rules';
import { cn } from '@/lib/utils';

import {
  argLabel,
  blankNode,
  coerceLiteral,
  describeArity,
  fitArgs,
  literalKind,
  nodeKind,
  operatorMeta,
  OPERATOR_GROUPS,
  OPERATOR_LIST,
  type LiteralKind,
  type NodeKind,
  type QuestionKeyRow,
} from './rule-catalog';

/**
 * The nested expression builder.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One component renders one node and recurses for an operation's arguments,
 * which is the only structure that matches the AST — there are exactly four
 * node kinds and an operation's argument is itself a node, so a flat "condition
 * row" editor could not express `yearsBetween(dob, today())` at all.
 *
 * Two things keep it comprehensible rather than a wall of pickers:
 *
 *   • Every argument carries the operator's own name for it ("From"/"To",
 *     "Lowest"/"Highest"), so a nested row says what it is for without the
 *     author holding the operator's signature in their head.
 *   • Nesting is drawn as a single indent with a rule down the left, at one
 *     step per level. Most rules are one or two levels deep; the compiler
 *     allows 24, and the panel stays readable well past where anyone should be
 *     writing a rule rather than splitting it in two.
 *
 * Editing is immutable throughout: a change to a leaf rebuilds the path up to
 * the root and hands a whole new tree to `onChange`, so the panel above can
 * recompile on every keystroke without tracking mutation.
 */

const NODE_KIND_LABELS: Record<NodeKind, string> = {
  lit: 'Fixed value',
  field: 'Question on this form',
  ref: 'Value from another form',
  op: 'Operation',
};

const LITERAL_KIND_LABELS: Record<LiteralKind, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'True / false',
  list: 'List',
  empty: 'Empty',
};

const REF_WHEN_LABELS: Record<RefWhen, string> = {
  LATEST: 'Most recent submission',
  FIRST: 'Earliest submission',
  REGISTRATION: 'Registration submission',
};

export interface ExpressionEditorProps {
  node: ExprNode;
  onChange: (node: ExprNode) => void;
  /** Question keys this form offers. Drives the field picker. */
  fields: QuestionKeyRow[];
  /** False on forms with no subject type — `ref` nodes are rejected at publish. */
  allowReferences: boolean;
  /** Name this node has in its parent operation, e.g. "From". */
  label?: string;
  /** Present on removable arguments of a variadic operation. */
  onRemove?: () => void;
  depth?: number;
}

export function ExpressionEditor({
  node,
  onChange,
  fields,
  allowReferences,
  label,
  onRemove,
  depth = 0,
}: ExpressionEditorProps) {
  const kind = nodeKind(node);

  const changeKind = (next: NodeKind) => {
    if (next === kind) return;
    onChange(blankNode(next, fields));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {label && (
          <span className="w-full text-xs font-medium text-muted-foreground sm:w-auto sm:min-w-24">
            {label}
          </span>
        )}

        <NativeSelect
          size="sm"
          className="w-full sm:w-52"
          aria-label={label ? `${label} — value source` : 'Value source'}
          value={kind}
          onChange={(e) => changeKind(e.target.value as NodeKind)}
        >
          {(Object.keys(NODE_KIND_LABELS) as NodeKind[]).map((option) => (
            <NativeSelectOption
              key={option}
              value={option}
              // Kept visible but unselectable when the form has no subject: the
              // author should learn the option exists and why it is unavailable,
              // rather than wonder where cross-form values went.
              disabled={option === 'ref' && !allowReferences}
            >
              {NODE_KIND_LABELS[option]}
              {option === 'ref' && !allowReferences ? ' (needs a subject)' : ''}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        {kind === 'lit' && (
          <LiteralFields
            value={'lit' in node ? node.lit : ''}
            onChange={(lit) => onChange({ lit })}
            label={label}
          />
        )}

        {kind === 'field' && (
          <FieldPicker
            value={'field' in node ? node.field : ''}
            onChange={(field) => onChange({ field })}
            fields={fields}
            label={label}
          />
        )}

        {kind === 'op' && (
          <OperatorPicker
            value={'op' in node ? node.op : ''}
            args={'op' in node ? node.args : []}
            onChange={onChange}
            label={label}
          />
        )}

        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onRemove}
            aria-label={`Remove ${label ?? 'input'}`}
            title="Remove this input"
            className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>

      {kind === 'ref' && 'ref' in node && (
        <RefFields
          value={node.ref}
          onChange={(ref) => onChange({ ref })}
          allowReferences={allowReferences}
        />
      )}

      {kind === 'op' && 'op' in node && (
        <OperationArgs
          node={node}
          onChange={onChange}
          fields={fields}
          allowReferences={allowReferences}
          depth={depth}
        />
      )}
    </div>
  );
}

// ── Operation ───────────────────────────────────────────────────────────────

function OperatorPicker({
  value,
  args,
  onChange,
  label,
}: {
  value: string;
  args: ExprNode[];
  onChange: (node: ExprNode) => void;
  label?: string;
}) {
  return (
    <NativeSelect
      size="sm"
      className="w-full sm:w-64"
      aria-label={label ? `${label} — operation` : 'Operation'}
      value={value}
      onChange={(e) => {
        const meta = operatorMeta(e.target.value);
        if (!meta) return;
        // Arguments survive the switch and are trimmed/padded to the new
        // operator's arity, so changing `eq` to `between` keeps both sides and
        // only asks for the third.
        onChange({ op: meta.name, args: fitArgs(args, meta) });
      }}
    >
      {/* Unknown operator names are surfaced rather than silently re-pointed at
          whatever happens to be first — the author needs to see the mismatch. */}
      {!operatorMeta(value) && (
        <NativeSelectOption value={value}>{value || 'Choose an operation…'}</NativeSelectOption>
      )}
      {OPERATOR_GROUPS.map((group) => {
        const members = OPERATOR_LIST.filter((op) => op.group === group);
        if (members.length === 0) return null;
        return (
          <NativeSelectOptGroup key={group} label={group}>
            {members.map((op) => (
              <NativeSelectOption key={op.name} value={op.name}>
                {op.label}
              </NativeSelectOption>
            ))}
          </NativeSelectOptGroup>
        );
      })}
    </NativeSelect>
  );
}

function OperationArgs({
  node,
  onChange,
  fields,
  allowReferences,
  depth,
}: {
  node: { op: string; args: ExprNode[] };
  onChange: (node: ExprNode) => void;
  fields: QuestionKeyRow[];
  allowReferences: boolean;
  depth: number;
}) {
  const meta = operatorMeta(node.op);
  const args = Array.isArray(node.args) ? node.args : [];

  // The two buttons are driven straight off the registry's arity, so the UI
  // physically cannot build an operation the compiler would reject for its
  // input count.
  const canAdd = !!meta && args.length < meta.maxArgs;
  const canRemove = !!meta && args.length > meta.minArgs;

  const setArg = (index: number, next: ExprNode) =>
    onChange({ op: node.op, args: args.map((arg, i) => (i === index ? next : arg)) });

  const removeArg = (index: number) =>
    onChange({ op: node.op, args: args.filter((_, i) => i !== index) });

  if (meta && meta.maxArgs === 0) {
    return (
      <p className="pl-2 text-xs text-muted-foreground sm:pl-28">{describeArity(meta)}</p>
    );
  }

  return (
    <div
      className={cn(
        'space-y-2.5 border-l border-border pl-3',
        // One indent step per level, capped so a deep tree does not walk itself
        // off the right-hand edge of the panel.
        depth < 4 ? 'ml-1 sm:ml-3' : 'ml-1',
      )}
    >
      {args.map((arg, index) => (
        <ExpressionEditor
          key={index}
          node={arg}
          onChange={(next) => setArg(index, next)}
          onRemove={canRemove ? () => removeArg(index) : undefined}
          fields={fields}
          allowReferences={allowReferences}
          label={argLabel(meta, index)}
          depth={depth + 1}
        />
      ))}

      {canAdd && (
        <Button
          variant="outline"
          size="xs"
          className="gap-1"
          onClick={() => onChange({ op: node.op, args: [...args, { lit: '' }] })}
        >
          <Plus className="size-3" />
          Add input
        </Button>
      )}
    </div>
  );
}

// ── Leaves ──────────────────────────────────────────────────────────────────

function FieldPicker({
  value,
  onChange,
  fields,
  label,
}: {
  value: string;
  onChange: (key: string) => void;
  fields: QuestionKeyRow[];
  label?: string;
}) {
  const known = fields.some((f) => f.key === value);

  return (
    <NativeSelect
      size="sm"
      className="w-full sm:w-64"
      aria-label={label ? `${label} — question` : 'Question'}
      value={value}
      disabled={fields.length === 0}
      onChange={(e) => onChange(e.target.value)}
    >
      {fields.length === 0 && <NativeSelectOption value="">No questions yet</NativeSelectOption>}
      {/* A key that no longer exists stays selected and visible, so the author
          can see which question went missing instead of the row silently
          snapping to an unrelated one. */}
      {!known && value && <NativeSelectOption value={value}>{value} (missing)</NativeSelectOption>}
      {!known && !value && fields.length > 0 && (
        <NativeSelectOption value="">Choose a question…</NativeSelectOption>
      )}
      {fields.map((field) => (
        <NativeSelectOption key={field.id} value={field.key}>
          {field.label} · {field.key}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function LiteralFields({
  value,
  onChange,
  label,
}: {
  value: RuleValue;
  onChange: (value: RuleValue) => void;
  label?: string;
}) {
  const kind = literalKind(value);

  return (
    <>
      <NativeSelect
        size="sm"
        className="w-full sm:w-32"
        aria-label={label ? `${label} — value type` : 'Value type'}
        value={kind}
        onChange={(e) => onChange(coerceLiteral(value, e.target.value as LiteralKind))}
      >
        {(Object.keys(LITERAL_KIND_LABELS) as LiteralKind[]).map((option) => (
          <NativeSelectOption key={option} value={option}>
            {LITERAL_KIND_LABELS[option]}
          </NativeSelectOption>
        ))}
      </NativeSelect>

      {kind === 'text' && (
        <Input
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label ? `${label} — text` : 'Text value'}
          placeholder="Text"
          className="h-7 w-full text-sm sm:w-48"
        />
      )}

      {kind === 'number' && (
        <Input
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(e) => {
            // An empty box is 0 rather than NaN — the compiler rejects nothing
            // here, but NaN would serialise as null and quietly change meaning.
            const next = Number(e.target.value);
            onChange(e.target.value === '' ? 0 : Number.isFinite(next) ? next : 0);
          }}
          aria-label={label ? `${label} — number` : 'Number value'}
          placeholder="0"
          className="h-7 w-full text-sm sm:w-32"
        />
      )}

      {kind === 'boolean' && (
        <NativeSelect
          size="sm"
          className="w-full sm:w-28"
          aria-label={label ? `${label} — true or false` : 'True or false'}
          value={value === true ? 'true' : 'false'}
          onChange={(e) => onChange(e.target.value === 'true')}
        >
          <NativeSelectOption value="true">True</NativeSelectOption>
          <NativeSelectOption value="false">False</NativeSelectOption>
        </NativeSelect>
      )}

      {kind === 'list' && (
        <Input
          value={Array.isArray(value) ? value.map((v) => String(v ?? '')).join(', ') : ''}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(',')
                .map((part) => part.trim())
                .filter((part) => part !== ''),
            )
          }
          aria-label={label ? `${label} — list` : 'List value'}
          placeholder="One, two, three"
          className="h-7 w-full text-sm sm:w-64"
        />
      )}

      {kind === 'empty' && (
        <span className="text-xs text-muted-foreground">No value (blank)</span>
      )}
    </>
  );
}

/**
 * Cross-form reference.
 *
 * The form list is fetched here rather than passed down so the request only
 * happens once an author actually adds a reference node — opening the panel on
 * a form that uses none costs nothing. React Query dedupes across the several
 * instances a rule set may contain.
 */
function RefFields({
  value,
  onChange,
  allowReferences,
}: {
  value: { form: string; question: string; when: RefWhen };
  onChange: (ref: { form: string; question: string; when: RefWhen }) => void;
  allowReferences: boolean;
}) {
  const { data, isLoading } = useForms({ limit: 100 });
  const forms = data?.forms ?? [];
  const known = forms.some((f) => f.id === value.form);

  return (
    <div className="space-y-2 border-l border-border pl-3 sm:ml-3">
      {!allowReferences && (
        <p className="text-xs text-destructive">
          This form is not linked to a subject, so it cannot read values from other forms. Publishing
          will fail until this node is replaced.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
        <NativeSelect
          size="sm"
          className="w-full"
          aria-label="Form to read from"
          value={value.form}
          disabled={!allowReferences}
          onChange={(e) => onChange({ ...value, form: e.target.value })}
        >
          <NativeSelectOption value="">
            {isLoading ? 'Loading forms…' : 'Choose a form…'}
          </NativeSelectOption>
          {!known && value.form && (
            <NativeSelectOption value={value.form}>{value.form}</NativeSelectOption>
          )}
          {forms.map((form) => (
            <NativeSelectOption key={form.id} value={form.id}>
              {form.title || 'Untitled form'}
            </NativeSelectOption>
          ))}
        </NativeSelect>

        {/* A free-text key rather than a picker: the other form's questions are
            a separate document, and its keys change with its own labels. The
            compiler cannot check this one either — it resolves at submit. */}
        <Input
          value={value.question}
          onChange={(e) => onChange({ ...value, question: e.target.value })}
          aria-label="Question key on that form"
          placeholder="question_key"
          disabled={!allowReferences}
          className="h-7 text-sm"
        />

        <NativeSelect
          size="sm"
          className="w-full"
          aria-label="Which submission to read"
          value={value.when}
          disabled={!allowReferences}
          onChange={(e) => onChange({ ...value, when: e.target.value as RefWhen })}
        >
          {REF_WHEN_VALUES.map((when) => (
            <NativeSelectOption key={when} value={when}>
              {REF_WHEN_LABELS[when]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
