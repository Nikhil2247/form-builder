'use client';

import React from 'react';
import { Database, Loader2, PencilLine } from 'lucide-react';

import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { useChoiceLists, type ChoiceListSummary } from '@/hooks/use-choice-lists';
import { deriveQuestionKeys } from '@/lib/question-keys';
import { cn } from '@/lib/utils';
import type { FormQuestion, QuestionOptionsSource } from '@/types/form';

/**
 * Where a choice question gets its options.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two modes, and the choice between them is the whole control:
 *
 *   • TYPED IN — the historical behaviour, a static array on the question.
 *     Right for "Yes / No / NA" and for anything the author invents.
 *   • FROM A LIST — a managed ChoiceList. Right for anything that exists
 *     independently of this form: districts, schools, vendors, departments.
 *     This is what makes a cascade and `lookup()` auto-fill possible.
 *
 * ── The cascade picker only offers what can actually work ──────────────────
 * A question can be filtered by another only if that other question is bound
 * to this list's PARENT list, and appears EARLIER in the form. Both are
 * enforced by the API on save, so offering anything else here would just
 * produce a save error the author cannot act on. The select is built from the
 * questions that pass both tests, and says so when none do.
 */

export interface OptionsSourcePickerProps {
  question: FormQuestion;
  /** All questions on the form, in order — needed to find valid parents. */
  questions: FormQuestion[];
  onChange: (optionsSource: QuestionOptionsSource | undefined) => void;
}

export function OptionsSourcePicker({ question, questions, onChange }: OptionsSourcePickerProps) {
  const { lists, isLoading, error } = useChoiceLists();
  const source = question.optionsSource;

  const listBySlug = React.useMemo(() => {
    const map = new Map<string, ChoiceListSummary>();
    for (const list of lists) map.set(list.slug, list);
    return map;
  }, [lists]);

  const selectedList = source ? listBySlug.get(source.listSlug) : undefined;

  /**
   * Questions that could legitimately filter this one.
   *
   * Two conditions, both of which the server also checks: the candidate must
   * come earlier in the form, and must be bound to the parent of this
   * question's list. Anything else produces an empty dropdown at runtime.
   */
  const parentCandidates = React.useMemo(() => {
    if (!selectedList?.parentList) return [];

    const keyRows = deriveQuestionKeys(questions);
    const index = questions.findIndex((q) => q.id === question.id);

    return keyRows
      .filter((row, rowIndex) => {
        if (rowIndex >= index) return false;
        const candidate = questions[rowIndex];
        return candidate.optionsSource?.listSlug === selectedList.parentList?.slug;
      })
      .map((row) => ({ key: row.key, label: row.label }));
  }, [selectedList, questions, question.id]);

  const setSource = (patch: Partial<QuestionOptionsSource>) => {
    if (!source) return;
    onChange({ ...source, ...patch });
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ModeButton
          active={!source}
          icon={PencilLine}
          label="Type your own options"
          onClick={() => onChange(undefined)}
        />
        <ModeButton
          active={!!source}
          icon={Database}
          label="Choose from a list"
          onClick={() => {
            if (source) return;
            const first = lists[0];
            if (first) onChange({ kind: 'CHOICE_LIST', listSlug: first.slug });
          }}
          disabled={lists.length === 0}
        />
        {isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />}
      </div>

      {error && (
        <p role="alert" className="text-xs font-semibold text-destructive">
          {error}
        </p>
      )}

      {!source && lists.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground">
          No managed lists yet. Create one under Choice lists to reuse options across forms.
        </p>
      )}

      {source && (
        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Which list
            </span>
            <NativeSelect
              size="sm"
              className="w-full"
              value={source.listSlug}
              onChange={(e) => {
                // Changing the list invalidates the parent binding — it named a
                // question bound to the OLD list's parent, which is unrelated to
                // the new one's.
                onChange({ kind: 'CHOICE_LIST', listSlug: e.target.value });
              }}
            >
              {/* A slug that no longer resolves stays selected so the author can
                  see what broke rather than silently getting another list. */}
              {!listBySlug.has(source.listSlug) && (
                <NativeSelectOption value={source.listSlug}>
                  {source.listSlug} (missing)
                </NativeSelectOption>
              )}
              {lists.map((list) => (
                <NativeSelectOption key={list.id} value={list.slug}>
                  {list.name}
                  {list.isGlobal ? ' · platform' : ''} · {list.itemCount} items
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>

          {selectedList?.parentList && (
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Narrow down by an earlier answer
              </span>
              {parentCandidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This list narrows down based on <strong>{selectedList.parentList.name}</strong>.
                  Add a question using that list <em>earlier</em> in the form so respondents can
                  pick it first.
                </p>
              ) : (
                <NativeSelect
                  size="sm"
                  className="w-full"
                  value={source.parentQuestionKey ?? ''}
                  onChange={(e) =>
                    setSource({ parentQuestionKey: e.target.value || undefined })
                  }
                >
                  <NativeSelectOption value="">
                    Show everything (don&rsquo;t narrow down)
                  </NativeSelectOption>
                  {parentCandidates.map((candidate) => (
                    <NativeSelectOption key={candidate.key} value={candidate.key}>
                      {candidate.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
            </label>
          )}

          {(selectedList?.metadataSchema?.length ?? 0) > 0 && (
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                What respondents see for each option
              </span>
              <NativeSelect
                size="sm"
                className="w-full"
                value={source.displayField ?? ''}
                onChange={(e) => setSource({ displayField: e.target.value || undefined })}
              >
                <NativeSelectOption value="">Item name (default)</NativeSelectOption>
                {selectedList?.metadataSchema?.map((column) => (
                  <NativeSelectOption key={column.key} value={column.key}>
                    {column.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Respondents choose from this list once the form is published. You can also set up a
            rule to fill in another field automatically from their pick — for example, showing a
            code as soon as they choose a name.
          </p>
        </div>
      )}
    </div>
  );
}

function ModeButton({
  active,
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-foreground/25 bg-muted text-foreground'
          : 'border-input bg-background text-muted-foreground hover:border-foreground/30',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}
