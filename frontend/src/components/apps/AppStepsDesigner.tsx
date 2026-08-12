'use client';

import React from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Fingerprint,
  Layers,
  ListOrdered,
  Loader2,
  Plus,
  Repeat,
  Settings2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/shared';
import { PanelBlock, PanelRow, PanelSection } from '@/components/builder/panel-primitives';
import { deriveQuestionKeys } from '@/lib/question-keys';
import { cn } from '@/lib/utils';
import { useForm, type Form } from '@/hooks/use-forms';
import {
  useCreateAppStep,
  useDeleteAppStep,
  useReorderAppSteps,
  useUpdateAppStep,
  type FormAppStep,
  type StepMode,
  type StepShapeDto,
} from '@/hooks/use-form-apps';

/**
 * The step designer — what an app actually *is*.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A form app is an ordered programme: a respondent block filled once, then
 * whatever repeatable sections the programme needs, then one submit. Each step
 * binds a published form to a position and states how many times it is filled.
 *
 * Two things here are not cosmetic:
 *
 *   • **Order is the order respondents see.** It is also what makes a condition
 *     on a later step legible, so reordering writes through to the server
 *     immediately rather than waiting for a save button — a step list that is
 *     one order on screen and another in the database is the kind of drift that
 *     only shows up in a respondent's report.
 *
 *   • **Every write is its own request.** Steps are rows with identity: the key
 *     is referenced by conditions and by every session entry ever staged
 *     against them. Sending the whole list back as a blob would rewrite keys
 *     under staged drafts, so there is no "save steps" button by design.
 *
 * Everything else — the app's name, its dashboard cards — still saves with the
 * page's save button, because those are fields on one row.
 */

const MAX_STEPS = 30;
const MAX_ENTRIES = 100;

export function AppStepsDesigner({
  appId,
  steps,
  subjectTypeId,
  availableForms,
  registrationFormId,
}: {
  appId: string;
  steps: FormAppStep[];
  subjectTypeId: string | null;
  /** Published forms in the org. Filtered here to the ones a step may use. */
  availableForms: Form[];
  /** The form that registers this record type, if the record type names one. */
  registrationFormId?: string | null;
}) {
  const createStep = useCreateAppStep();
  const reorder = useReorderAppSteps();
  const [openStepId, setOpenStepId] = React.useState<string | null>(null);
  const [pickerFormId, setPickerFormId] = React.useState('');

  /**
   * A step's form must be bound to this app's record type or to none — the
   * server enforces it, and offering a form it will reject is worse than not
   * offering it. Already-used forms stay in the list: the same form legitimately
   * appears twice when a programme collects it under two headings.
   */
  const eligibleForms = React.useMemo(
    () =>
      availableForms.filter(
        (form) => !form.subjectTypeId || !subjectTypeId || form.subjectTypeId === subjectTypeId,
      ),
    [availableForms, subjectTypeId],
  );

  const move = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;

    const ids = steps.map((step) => step.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];

    try {
      await reorder.mutateAsync({ appId, stepIds: ids });
    } catch {
      // Reported globally; the query invalidation restores the real order.
    }
  };

  const addStep = async () => {
    const form = eligibleForms.find((candidate) => candidate.id === pickerFormId);
    if (!form) return;

    try {
      const created = await createStep.mutateAsync({
        appId,
        formId: form.id,
        title: form.title,
        // A registration form identifies the record everything else attaches to,
        // so it is filled exactly once. Anything else starts repeatable, which
        // is the case a step exists to express.
        mode: form.id === registrationFormId ? 'SINGLE' : 'REPEATABLE',
        ...(form.id === registrationFormId ? {} : { minEntries: 0, maxEntries: 20, isOptional: true }),
      });
      setPickerFormId('');
      setOpenStepId(created.id);
    } catch {
      // Reported globally; the picker keeps its selection for a retry.
    }
  };

  return (
    <PanelSection
      title="Steps"
      description="What a respondent works through, in order. Each step is one published form; a repeatable step is filled once per record — one per training, one per visit."
      action={<Badge variant="secondary">{steps.length} / {MAX_STEPS}</Badge>}
    >
      {steps.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={ListOrdered}
          title="No steps yet"
          description="Add the form that identifies the respondent first — everything after it is attached to the record that form registers."
        />
      ) : (
        <ol className="space-y-2 py-3">
          {steps.map((step, index) => (
            <StepCard
              key={step.id}
              appId={appId}
              step={step}
              index={index}
              total={steps.length}
              isOpen={openStepId === step.id}
              onToggle={() => setOpenStepId((current) => (current === step.id ? null : step.id))}
              onMove={(delta) => move(index, delta)}
              isReordering={reorder.isPending}
            />
          ))}
        </ol>
      )}

      <PanelBlock
        label="Add a step"
        htmlFor="app-step-form"
        hint={
          steps.length >= MAX_STEPS
            ? `An app may have at most ${MAX_STEPS} steps.`
            : eligibleForms.length === 0
              ? 'No published form is available for this record type. Publish one first.'
              : 'Only published forms bound to this record type — or to none — can be a step.'
        }
        hintTone={steps.length >= MAX_STEPS ? 'warning' : 'muted'}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <NativeSelect
            id="app-step-form"
            className="min-w-0 flex-1"
            value={pickerFormId}
            onChange={(e) => setPickerFormId(e.target.value)}
            disabled={eligibleForms.length === 0 || steps.length >= MAX_STEPS}
          >
            <NativeSelectOption value="">Choose a form…</NativeSelectOption>
            {eligibleForms.map((form) => (
              <NativeSelectOption key={form.id} value={form.id}>
                {form.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            className="gap-2 sm:w-auto"
            onClick={addStep}
            disabled={!pickerFormId || createStep.isPending || steps.length >= MAX_STEPS}
          >
            {createStep.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add step
          </Button>
        </div>
      </PanelBlock>
    </PanelSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function StepCard({
  appId,
  step,
  index,
  total,
  isOpen,
  onToggle,
  onMove,
  isReordering,
}: {
  appId: string;
  step: FormAppStep;
  index: number;
  total: number;
  isOpen: boolean;
  onToggle: () => void;
  onMove: (delta: number) => void;
  isReordering: boolean;
}) {
  const updateStep = useUpdateAppStep();
  const deleteStep = useDeleteAppStep();

  const patch = async (dto: StepShapeDto) => {
    try {
      await updateStep.mutateAsync({ appId, stepId: step.id, ...dto });
    } catch {
      // Reported globally.
    }
  };

  const remove = async () => {
    try {
      await deleteStep.mutateAsync({ appId, stepId: step.id });
      toast.success(`Removed "${step.title}"`);
    } catch {
      // The server refuses when another step's condition reads this one, and
      // its message names that step; the global handler surfaces it verbatim.
    }
  };

  const entriesLabel =
    step.mode === 'SINGLE'
      ? 'Filled once'
      : step.maxEntries === null
        ? `${step.minEntries}+ entries`
        : `${step.minEntries}–${step.maxEntries} entries`;

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-start gap-2 p-3">
        <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
          {index + 1}
        </span>

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="min-w-0 flex-1 text-left"
        >
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{step.title}</span>
            {!step.isUsable && (
              <Badge variant="destructive" className="gap-1 font-normal">
                <AlertTriangle className="size-3" />
                Form not published
              </Badge>
            )}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="truncate">{step.form?.title ?? 'Unknown form'}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              {step.mode === 'REPEATABLE' ? (
                <Repeat className="size-3" />
              ) : (
                <Layers className="size-3" />
              )}
              {entriesLabel}
            </span>
            {step.isOptional && (
              <>
                <span aria-hidden>·</span>
                <span>Optional</span>
              </>
            )}
            {step.uniqueBy.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Fingerprint className="size-3" />
                  unique by {step.uniqueBy.join(', ')}
                </span>
              </>
            )}
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move "${step.title}" earlier`}
            disabled={index === 0 || isReordering}
            onClick={() => onMove(-1)}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Move "${step.title}" later`}
            disabled={index === total - 1 || isReordering}
            onClick={() => onMove(1)}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Configure "${step.title}"`}
            aria-pressed={isOpen}
            onClick={onToggle}
          >
            <Settings2 className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove "${step.title}"`}
            disabled={deleteStep.isPending}
            onClick={remove}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {isOpen && <StepEditor step={step} onPatch={patch} isSaving={updateStep.isPending} />}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * The per-step settings, opened in place.
 *
 * Text fields commit on blur and switches/selects commit immediately — the same
 * split the form settings panel uses, and for the same reason: a PATCH per
 * keystroke on a title is a request storm, while a switch that waits for a blur
 * that may never come reads as broken.
 */
function StepEditor({
  step,
  onPatch,
  isSaving,
}: {
  step: FormAppStep;
  onPatch: (dto: StepShapeDto) => void | Promise<void>;
  isSaving: boolean;
}) {
  const [title, setTitle] = React.useState(step.title);
  const [description, setDescription] = React.useState(step.description ?? '');

  // Adjusted during render rather than from an effect: the server normalises
  // what it stores (it truncates, and it pins min/max when a step becomes
  // SINGLE), and syncing that in an effect would show the stale value for a
  // frame before correcting itself.
  const [synced, setSynced] = React.useState(step);
  if (synced !== step) {
    setSynced(step);
    setTitle(step.title);
    setDescription(step.description ?? '');
  }

  // Only fetched while the editor is open — a 30-step app would otherwise pull
  // 30 full form documents to populate pickers nobody has looked at.
  const form = useForm(step.formId);
  const questionKeys = React.useMemo(
    () => deriveQuestionKeys(form.data?.questionsJson ?? []),
    [form.data],
  );

  const isRepeatable = step.mode === 'REPEATABLE';

  const toggleUniqueBy = (key: string) => {
    const next = step.uniqueBy.includes(key)
      ? step.uniqueBy.filter((existing) => existing !== key)
      : [...step.uniqueBy, key];
    onPatch({ uniqueBy: next });
  };

  return (
    <div className="border-t border-border bg-muted/30 px-3 pb-3 sm:px-4">
      <div className="divide-y divide-border">
        <PanelBlock label="Step title" htmlFor={`step-title-${step.id}`} hint={`Address: ${step.key}`}>
          <Input
            id={`step-title-${step.id}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== step.title && onPatch({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="h-8 text-xs"
          />
        </PanelBlock>

        <PanelBlock
          label="Instructions"
          htmlFor={`step-desc-${step.id}`}
          hint="Shown above the step's questions."
        >
          <Textarea
            id={`step-desc-${step.id}`}
            rows={2}
            value={description}
            placeholder="Optional"
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() =>
              description !== (step.description ?? '') &&
              onPatch({ description: description.trim() || null })
            }
            className="text-xs"
          />
        </PanelBlock>

        <PanelRow
          icon={Repeat}
          title="How many times"
          hint={
            isRepeatable
              ? 'Respondents add as many entries as they have records for.'
              : 'Exactly one entry. Use this for the block that identifies the respondent.'
          }
        >
          <NativeSelect
            className="w-full sm:w-44"
            value={step.mode}
            aria-label="Step mode"
            onChange={(e) => onPatch({ mode: e.target.value as StepMode })}
          >
            <NativeSelectOption value="SINGLE">Filled once</NativeSelectOption>
            <NativeSelectOption value="REPEATABLE">Repeatable</NativeSelectOption>
          </NativeSelect>
        </PanelRow>

        {isRepeatable && (
          <PanelRow
            icon={ListOrdered}
            title="Entry count"
            hint="A minimum of 0 lets a respondent with nothing to report leave the step empty."
          >
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={0}
                max={MAX_ENTRIES}
                aria-label="Minimum entries"
                className="tabular h-8 w-20 text-xs"
                value={step.minEntries}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  onPatch({ minEntries: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 });
                }}
              />
              <span className="text-xs text-muted-foreground">to</span>
              <Input
                type="number"
                min={1}
                max={MAX_ENTRIES}
                aria-label="Maximum entries"
                placeholder="No limit"
                className="tabular h-8 w-24 text-xs"
                value={step.maxEntries ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  const parsed = Number.parseInt(raw, 10);
                  onPatch({
                    maxEntries: raw === '' || !Number.isFinite(parsed) ? null : Math.max(1, parsed),
                  });
                }}
              />
            </div>
          </PanelRow>
        )}

        <PanelRow
          icon={Layers}
          title="Optional step"
          hint="An optional step can be left empty even when its minimum is above zero — the minimum then applies only once the respondent starts it."
        >
          <Switch
            checked={step.isOptional}
            aria-label="Optional step"
            onCheckedChange={(checked) => onPatch({ isOptional: checked })}
          />
        </PanelRow>

        {isRepeatable && (
          <PanelBlock
            label="No duplicates by"
            hint={
              form.isLoading
                ? 'Loading this form’s questions…'
                : questionKeys.length === 0
                  ? 'This form has no questions to key on yet.'
                  : 'Two entries of this step may not share the same answer to these questions — the submit is rejected naming the duplicate.'
            }
          >
            {questionKeys.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {questionKeys.map((row) => {
                  const active = step.uniqueBy.includes(row.key);
                  return (
                    <button
                      key={row.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleUniqueBy(row.key)}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {row.label}
                    </button>
                  );
                })}
              </div>
            )}
          </PanelBlock>
        )}
      </div>

      {isSaving && (
        <p className="flex items-center gap-1.5 pb-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Saving…
        </p>
      )}
    </div>
  );
}
