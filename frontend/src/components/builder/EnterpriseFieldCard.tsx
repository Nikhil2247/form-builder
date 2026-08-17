'use client';

import React, { memo, useCallback, useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Calendar,
  Check,
  Copy,
  GitBranch,
  GripVertical,
  Heading as HeadingIcon,
  Key,
  PenTool,
  Plus,
  Star,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { cn, selectAllOnFocus } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useBuilderStore, useFormSnapshot, useQuestion } from '@/store/builder-store';
import { gridSpanOf } from '@/types/form';
import type { FormQuestion, QuestionOption, QuestionWidth } from '@/types/form';
import { OptionsSourcePicker } from './OptionsSourcePicker';
import { RichTextEditor } from './RichTextEditor';

/**
 * One question on the canvas.
 *
 * Perf contract — do not break these without measuring:
 *
 *  1. Props are `id` and `index` only. The previous signature took the whole
 *     `question` object, `isSelected`, four callbacks, and `allQuestions` — the
 *     last of which changed identity on every keystroke anywhere in the form,
 *     so `memo` could never have helped even if it had been applied.
 *  2. Data comes from `useQuestion(id)`, a store slice. Editing another
 *     question does not touch this component.
 *  3. Selection is read as a boolean, not passed down, so selecting a card
 *     re-renders exactly two cards rather than all of them.
 *  4. Actions are read individually off the store; zustand keeps their identity
 *     stable, so the memo comparison holds.
 *
 * Together these take a keystroke in a 50-question form from 50 card renders
 * to 1.
 */

interface EnterpriseFieldCardProps {
  id: string;
  index: number;
}

const CHOICE_TYPES = ['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'] as const;

function slugifyOption(label: string) {
  return (
    label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'option'
  );
}

function EnterpriseFieldCardImpl({ id, index }: EnterpriseFieldCardProps) {
  const question = useQuestion(id);
  const isSelected = useBuilderStore((s) => s.selectedQuestionId === id);
  const isQuizMode = useBuilderStore((s) => s.isQuizMode);
  const logicRuleCount = useBuilderStore(
    (s) => s.logic.filter((r) => r.triggerQuestionId === id || r.targetQuestionId === id).length,
  );

  const isGridLayout = useBuilderStore((s) => s.settings.layoutMode === 'GRID');
  const pages = useBuilderStore((s) => s.pages);

  const patchQuestion = useBuilderStore((s) => s.patchQuestion);
  const deleteQuestion = useBuilderStore((s) => s.deleteQuestion);
  const duplicateQuestion = useBuilderStore((s) => s.duplicateQuestion);
  const selectQuestion = useBuilderStore((s) => s.selectQuestion);
  const addQuestion = useBuilderStore((s) => s.addQuestion);
  const setActiveView = useBuilderStore((s) => s.setActiveView);

  const [isAnswerKeyOpen, setIsAnswerKeyOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = useMemo(
    () => ({
      transform: CSS.Translate.toString(transform),
      transition,
      // The card stays in place at reduced opacity; dnd-kit renders the moving
      // copy. `CSS.Transform` (with scale) was distorting the card mid-drag.
      opacity: isDragging ? 0.4 : 1,
      zIndex: isDragging ? 20 : undefined,
    }),
    [transform, transition, isDragging],
  );

  const patch = useCallback(
    (changes: Parameters<typeof patchQuestion>[1]) => patchQuestion(id, changes),
    [patchQuestion, id],
  );

  const handleOptionLabel = useCallback(
    (optionId: string, label: string) => {
      if (!question?.options) return;
      patch({
        options: question.options.map((o) =>
          o.id === optionId ? { ...o, label, value: slugifyOption(label) } : o,
        ),
      });
    },
    [patch, question?.options],
  );

  const handleToggleCorrect = useCallback(
    (optionId: string) => {
      if (!question?.options) return;
      const single = question.type === 'SINGLE_CHOICE' || question.type === 'DROPDOWN';
      patch({
        options: question.options.map((o) =>
          single
            ? { ...o, isCorrect: o.id === optionId ? !o.isCorrect : false }
            : o.id === optionId
              ? { ...o, isCorrect: !o.isCorrect }
              : o,
        ),
      });
    },
    [patch, question?.options, question?.type],
  );

  const handleAddOption = useCallback(() => {
    const existing = question?.options ?? [];
    const next = existing.length + 1;
    const option: QuestionOption = {
      id: `opt_${Math.random().toString(36).slice(2, 10)}`,
      label: `Option ${next}`,
      value: `option_${next}`,
      isCorrect: false,
    };
    patch({ options: [...existing, option] });
  }, [patch, question?.options]);

  const handleRemoveOption = useCallback(
    (optionId: string) => {
      if (!question?.options) return;
      // A choice question with no options cannot be answered, and the API's
      // validator rejects the whole submission. Keep at least one.
      if (question.options.length <= 1) return;
      patch({ options: question.options.filter((o) => o.id !== optionId) });
    },
    [patch, question?.options],
  );

  // The store may have removed this question between the parent's render and
  // ours (delete during drag, for instance).
  if (!question) return null;

  const isSection = question.type === 'SECTION_HEADER';
  const isChoice = (CHOICE_TYPES as readonly string[]).includes(question.type);
  const required = question.validation?.required ?? false;
  // A matrix or a long answer takes the whole row whatever the author picks, so
  // offering the toggle would be offering a control that does nothing.
  const isAlwaysFullWidth = gridSpanOf({ type: question.type, width: 'HALF' }) === 2;

  // Only worth showing once there is more than one page to move a field to —
  // a single-page form has nothing for this control to offer.
  const pageSelect = pages.length > 1 && (
    <select
      aria-label="Move to page"
      title="Move to page"
      value={question.pageNumber ?? 1}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        patch({ pageNumber: Number(e.target.value) });
      }}
      className="h-7 shrink-0 rounded-md border border-border bg-background px-1.5 text-[11px]
                 text-muted-foreground hover:border-border-strong focus-visible:outline-none"
    >
      {pages.map((p) => (
        <option key={p.pageNumber} value={p.pageNumber}>
          {p.title || `Page ${p.pageNumber}`}
        </option>
      ))}
    </select>
  );

  const dragHandle = (
    <button
      {...attributes}
      {...listeners}
      type="button"
      aria-label={isSection ? 'Reorder section' : `Reorder question ${index + 1}`}
      className="shrink-0 cursor-grab rounded-md p-1 text-muted-foreground
                 hover:bg-muted hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical className="size-4" />
    </button>
  );

  const duplicateDeleteButtons = (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon-sm"
        title={isSection ? 'Duplicate section' : 'Duplicate question'}
        aria-label={isSection ? 'Duplicate section' : 'Duplicate question'}
        onClick={(e) => {
          e.stopPropagation();
          duplicateQuestion(id);
        }}
        className="text-muted-foreground hover:text-foreground"
      >
        <Copy className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        title={isSection ? 'Delete section' : 'Delete question'}
        aria-label={isSection ? 'Delete section' : 'Delete question'}
        onClick={(e) => {
          e.stopPropagation();
          deleteQuestion(id);
        }}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );

  if (isSection) {
    return (
      <div ref={setNodeRef} style={style} data-question-id={id} className="group/field">
        <Card
          onClick={() => !isSelected && selectQuestion(id)}
          className={cn(
            'space-y-3 border-dashed bg-muted/20 p-4 transition-shadow',
            isSelected
              ? 'border-foreground/25 ring-1 ring-foreground/15'
              : 'hover:border-border-strong',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {dragHandle}
              <HeadingIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <Input
                value={question.label}
                onChange={(e) => patch({ label: e.target.value })}
                onFocus={selectAllOnFocus}
                placeholder="Section title"
                aria-label="Section title"
                className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-base font-semibold shadow-none
                           focus-visible:border-b focus-visible:border-foreground/30 focus-visible:ring-0"
              />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {pageSelect}
              {duplicateDeleteButtons}
            </div>
          </div>

          <RichTextEditor
            value={question.description ?? ''}
            onChange={(html) => patch({ description: html })}
            ariaLabel="Section description"
            placeholder="Section description (optional)"
            className="pl-1"
          />
        </Card>

        <div
          className="flex justify-center py-1 opacity-0 transition-opacity
                     focus-within:opacity-100 group-hover/field:opacity-100"
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => addQuestion('SHORT_TEXT', id)}
            className="h-7 gap-1 rounded-full bg-background text-xs shadow-card"
          >
            <Plus className="size-3" />
            Add field below
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} data-question-id={id} className="group/field">
      <Card
        onClick={() => !isSelected && selectQuestion(id)}
        className={cn(
          'space-y-4 p-4 transition-shadow',
          isSelected
            ? 'border-foreground/25 ring-1 ring-foreground/15'
            : 'hover:border-border-strong',
        )}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {dragHandle}

            <span className="tabular shrink-0 text-xs font-semibold text-muted-foreground">
              Q{index + 1}
            </span>

            <Input
              value={question.label}
              onChange={(e) => patch({ label: e.target.value })}
              onFocus={selectAllOnFocus}
              placeholder="Question text"
              aria-label={`Question ${index + 1} label`}
              className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none
                         focus-visible:border-b focus-visible:border-foreground/30 focus-visible:ring-0"
            />

            {logicRuleCount > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveView('LOGIC');
                }}
                className="shrink-0"
                title="This question is used by conditional logic"
              >
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <GitBranch className="size-2.5" />
                  {logicRuleCount}
                </Badge>
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {/* The points control only exists for quizzes. It used to render
                unconditionally, so every form showed a "0 pts" button that did
                nothing. */}
            {isQuizMode && (
              <Button
                variant={question.points ? 'secondary' : 'outline'}
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsAnswerKeyOpen((open) => !open);
                }}
                aria-expanded={isAnswerKeyOpen}
                className="gap-1.5"
              >
                <Key className="size-3" />
                <span className="tabular">{question.points || 0} pts</span>
              </Button>
            )}

            {/* Width matters only in a GRID form, so the control appears only
                there. Showing it on a DOCUMENT form would offer a setting that
                changes nothing the author can see. */}
            {isGridLayout && !isAlwaysFullWidth && (
              <WidthToggle
                value={question.width ?? 'AUTO'}
                onChange={(width) => patch({ width })}
                questionId={id}
              />
            )}

            {pageSelect}

            <div className="flex items-center gap-2">
              <Switch
                id={`required-${id}`}
                checked={required}
                onCheckedChange={(checked) =>
                  patch({ validation: { ...question.validation, required: checked } })
                }
              />
              <Label htmlFor={`required-${id}`} className="cursor-pointer text-xs">
                Required
              </Label>
            </div>

            {duplicateDeleteButtons}
          </div>
        </div>

        {/* ── Help text ──────────────────────────────────────────────────── */}
        {isSelected && (
          <Input
            value={question.description ?? ''}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Help text shown under the question (optional)"
            className="h-8 border-0 bg-transparent px-1 text-xs text-muted-foreground shadow-none
                       focus-visible:border-b focus-visible:border-border-strong focus-visible:ring-0"
          />
        )}

        {/* ── Quiz answer key ────────────────────────────────────────────── */}
        {isQuizMode && isAnswerKeyOpen && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Key className="size-3.5" />
                Answer key
              </span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Points
                <Input
                  type="number"
                  min={0}
                  max={1000}
                  value={question.points ?? 0}
                  onChange={(e) => {
                    const points = Number.parseInt(e.target.value, 10);
                    patch({ points: Number.isFinite(points) && points >= 0 ? points : 0 });
                  }}
                  className="tabular h-7 w-16 bg-background text-xs"
                />
              </label>
            </div>
            {isChoice ? (
              <p className="text-xs text-muted-foreground">
                Tick the correct option{question.type === 'MULTI_CHOICE' ? 's' : ''} below.
              </p>
            ) : (
              <Input
                value={(question.correctAnswer as string) ?? ''}
                onChange={(e) => patch({ correctAnswer: e.target.value })}
                placeholder="Expected answer"
                className="h-8 bg-background text-xs"
              />
            )}
          </div>
        )}

        {/* ── Where the options come from ────────────────────────────────── */}
        {/* Only while the card is selected: an author scanning a long form
            should see the question, not every question's data plumbing. */}
        {isChoice && isSelected && (
          <ConnectedOptionsSource question={question} onPatch={patch} />
        )}

        {/* ── Preview of the respondent's control ────────────────────────── */}
        <div className="rounded-lg border border-dashed border-border bg-muted/25 p-3">
          <QuestionPreview
            question={question}
            isChoice={isChoice}
            showAnswerKey={isQuizMode && isAnswerKeyOpen}
            onOptionLabel={handleOptionLabel}
            onToggleCorrect={handleToggleCorrect}
            onAddOption={handleAddOption}
            onRemoveOption={handleRemoveOption}
          />
        </div>
      </Card>

      {/* Insert-below affordance. Was `opacity-0 hover:opacity-100` on the
          element itself, so it could never be hovered — it had zero opacity and
          the pointer never reached it. Now driven by the card's hover group and
          always reachable by keyboard. */}
      <div
        className="flex justify-center py-1 opacity-0 transition-opacity
                   focus-within:opacity-100 group-hover/field:opacity-100"
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => addQuestion('SHORT_TEXT', id)}
          className="h-7 gap-1 rounded-full bg-background text-xs shadow-card"
        >
          <Plus className="size-3" />
          Add field below
        </Button>
      </div>
    </div>
  );
}

/**
 * The options-source panel, wired to the store.
 *
 * A cascade needs to know every question on the form and their order, which is
 * the whole document — exactly the subscription this card exists to avoid. It
 * is confined to this wrapper, which only mounts for the SELECTED card, so at
 * most one card is ever subscribed to the snapshot and the rest of the canvas
 * stays off the re-render-per-keystroke path.
 */
function ConnectedOptionsSource({
  question,
  onPatch,
}: {
  question: FormQuestion;
  onPatch: (patch: Partial<FormQuestion>) => void;
}) {
  const form = useFormSnapshot();
  return (
    <OptionsSourcePicker
      question={question}
      questions={form.questions}
      onChange={(optionsSource) => onPatch({ optionsSource })}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewProps {
  question: NonNullable<ReturnType<typeof useQuestion>>;
  isChoice: boolean;
  showAnswerKey: boolean;
  onOptionLabel: (optionId: string, label: string) => void;
  onToggleCorrect: (optionId: string) => void;
  onAddOption: () => void;
  onRemoveOption: (optionId: string) => void;
}

function QuestionPreview({
  question,
  isChoice,
  showAnswerKey,
  onOptionLabel,
  onToggleCorrect,
  onAddOption,
  onRemoveOption,
}: PreviewProps) {
  if (isChoice) {
    // Options come from the managed list picked above — the manual option
    // rows below would be dead data nobody reads, so there is nothing to edit
    // here.
    if (question.optionsSource) {
      return (
        <p className="text-xs text-muted-foreground">
          Respondents will pick from the selected list. There are no manual options to edit.
        </p>
      );
    }

    return (
      <div className="max-w-md space-y-1.5">
        {question.options?.map((option) => (
          <div key={option.id} className="group/option flex items-center gap-2">
            {showAnswerKey ? (
              <button
                type="button"
                onClick={() => onToggleCorrect(option.id)}
                aria-pressed={!!option.isCorrect}
                aria-label={`Mark "${option.label}" as correct`}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded border transition-colors',
                  option.isCorrect
                    ? 'border-success bg-success text-success-foreground'
                    : 'border-input bg-background text-transparent hover:border-foreground/40',
                )}
              >
                <Check className="size-3" />
              </button>
            ) : (
              <span
                aria-hidden
                className={cn(
                  'size-4 shrink-0 border border-input bg-background',
                  question.type === 'SINGLE_CHOICE' ? 'rounded-full' : 'rounded-sm',
                )}
              />
            )}

            <Input
              value={option.label}
              onChange={(e) => onOptionLabel(option.id, e.target.value)}
              onFocus={selectAllOnFocus}
              aria-label="Option label"
              className="h-8 border-transparent bg-background text-sm shadow-none hover:border-input focus-visible:border-input"
            />

            {showAnswerKey && option.isCorrect && (
              <span className="shrink-0 rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                Correct
              </span>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove option "${option.label}"`}
              onClick={() => onRemoveOption(option.id)}
              disabled={(question.options?.length ?? 0) <= 1}
              className="opacity-0 transition-opacity group-focus-within/option:opacity-100 group-hover/option:opacity-100"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}

        <Button variant="ghost" size="sm" onClick={onAddOption} className="mt-1 gap-1">
          <Plus className="size-3.5" />
          Add option
        </Button>
      </div>
    );
  }

  switch (question.type) {
    case 'LONG_TEXT':
      return (
        <textarea
          disabled
          placeholder={question.placeholder || 'Long answer…'}
          className="min-h-20 w-full max-w-md resize-none rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground"
        />
      );

    case 'DATE':
      return (
        <div className="flex max-w-md items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
          <Calendar className="size-3.5" />
          <span>Select a date</span>
        </div>
      );

    case 'FILE_UPLOAD':
      return (
        <div className="flex max-w-md flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-background p-5">
          <UploadCloud className="mb-2 size-5 text-muted-foreground" />
          <span className="text-xs font-medium">Drag and drop, or browse</span>
          <span className="text-[11px] text-muted-foreground">
            {question.validation?.allowedTypes?.join(', ') || 'JPG, PNG, PDF'} · up to{' '}
            {question.validation?.maxSizeMb ?? 10} MB
          </span>
        </div>
      );

    case 'SIGNATURE':
      return (
        <div className="flex h-20 max-w-md items-center justify-center gap-2 rounded-md border border-input bg-background text-muted-foreground">
          <PenTool className="size-4 opacity-50" />
          <span className="text-xs">Sign here</span>
        </div>
      );

    case 'STAR_RATING':
      return (
        <div className="flex items-center gap-1 text-muted-foreground" aria-hidden>
          {[1, 2, 3, 4, 5].map((star) => (
            <Star key={star} className="size-5" />
          ))}
        </div>
      );

    case 'NPS':
      return (
        <div className="flex max-w-md flex-wrap gap-1" aria-hidden>
          {Array.from({ length: 11 }, (_, n) => (
            <span
              key={n}
              className="tabular flex size-7 items-center justify-center rounded-md border border-input bg-background text-xs text-muted-foreground"
            >
              {n}
            </span>
          ))}
        </div>
      );

    case 'SLIDER':
      return (
        <div className="max-w-md space-y-1.5">
          <input type="range" disabled className="w-full accent-foreground" />
          <div className="tabular flex justify-between text-[11px] text-muted-foreground">
            <span>{question.sliderMin ?? 0}</span>
            <span>{question.sliderMax ?? 100}</span>
          </div>
        </div>
      );

    case 'MATRIX':
      return (
        <div className="max-w-lg overflow-x-auto">
          <table className="w-full text-xs text-muted-foreground">
            <thead>
              <tr>
                <th className="p-1.5 text-left" />
                {(question.matrixColumns ?? []).map((column) => (
                  <th key={column} className="p-1.5 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(question.matrixRows ?? []).map((row) => (
                <tr key={row} className="border-t border-border">
                  <td className="p-1.5 text-left">{row}</td>
                  {(question.matrixColumns ?? []).map((column) => (
                    <td key={column} className="p-1.5 text-center">
                      <span
                        aria-hidden
                        className="inline-block size-3.5 rounded-full border border-input bg-background"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return (
        <input
          disabled
          type={question.type === 'NUMBER' ? 'number' : 'text'}
          placeholder={
            question.placeholder ||
            { EMAIL: 'name@example.com', PHONE: '+1 555 000 0000', URL: 'https://' }[
              question.type as 'EMAIL' | 'PHONE' | 'URL'
            ] ||
            'Short answer…'
          }
          className="h-9 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm text-muted-foreground"
        />
      );
  }
}

/**
 * `memo` is load-bearing here, not a micro-optimisation: the canvas maps over
 * every id on any structural change, and without this each of those renders
 * would rebuild the full card subtree.
 */
export const EnterpriseFieldCard = memo(EnterpriseFieldCardImpl);
EnterpriseFieldCard.displayName = 'EnterpriseFieldCard';

/**
 * How wide this question sits in a two-column form.
 *
 * Three states rather than a half/full switch, because "Auto" is a real and
 * usually correct answer — it means "pair up unless the control needs room",
 * which is what an author wants for almost every field. A binary toggle would
 * force a decision on all of them.
 */
function WidthToggle({
  value,
  onChange,
  questionId,
}: {
  value: QuestionWidth;
  onChange: (width: QuestionWidth) => void;
  questionId: string;
}) {
  const OPTIONS: Array<{ value: QuestionWidth; label: string; title: string }> = [
    { value: 'AUTO', label: 'Auto', title: 'Pair up with the next field unless this control needs the full row' },
    { value: 'HALF', label: 'Half', title: 'Always take half the row' },
    { value: 'FULL', label: 'Full', title: 'Always take the whole row' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Field width"
      className="flex items-center overflow-hidden rounded-md border border-border"
      onClick={(e) => e.stopPropagation()}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          id={`width-${option.value}-${questionId}`}
          onClick={() => onChange(option.value)}
          className={cn(
            'px-2 py-1 text-[11px] font-medium transition-colors',
            value === option.value
              ? 'bg-primary/10 text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
