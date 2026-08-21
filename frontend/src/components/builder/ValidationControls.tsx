'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FormQuestion, QuestionType, QuestionValidation } from '@/types/form';

/**
 * Per-type validation settings — min/max length, numeric ranges, phone
 * format, selection counts, rating scale, slider bounds, file constraints.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `QuestionValidation` (min/max/minLength/maxLength/pattern/allowedTypes/
 * maxSizeMb) has been fully modelled and fully enforced by the API and the
 * public runner since those were built. The builder never gave an author a
 * way to set any of it beyond "Required" — this is that missing control
 * surface, not a new capability.
 *
 * `hasValidationControls` gates whether the card even shows the "Validation"
 * box, so a type with nothing to configure here (EMAIL, DATE, SIGNATURE, a
 * choice question's options are edited in the preview, …) does not render an
 * empty bordered box.
 */

const SUPPORTED_TYPES: ReadonlySet<QuestionType> = new Set([
  'SHORT_TEXT',
  'LONG_TEXT',
  'PHONE',
  'NUMBER',
  'MULTI_CHOICE',
  'STAR_RATING',
  'SLIDER',
  'FILE_UPLOAD',
]);

export function hasValidationControls(type: QuestionType): boolean {
  return SUPPORTED_TYPES.has(type);
}

interface ValidationControlsProps {
  question: FormQuestion;
  onPatch: (patch: Partial<FormQuestion>) => void;
}

export function ValidationControls({ question, onPatch }: ValidationControlsProps) {
  const v = question.validation ?? {};
  const patchValidation = (patch: Partial<QuestionValidation>) =>
    onPatch({ validation: { ...v, ...patch } });

  switch (question.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT':
      return (
        <div className="flex flex-wrap items-end gap-3">
          <NumberField
            label="Min length"
            value={v.minLength}
            min={0}
            onChange={(n) => patchValidation({ minLength: n })}
          />
          <NumberField
            label="Max length"
            value={v.maxLength}
            min={0}
            onChange={(n) => patchValidation({ maxLength: n })}
          />
          <PatternField
            label="Format"
            pattern={v.pattern}
            presets={TEXT_PATTERN_PRESETS}
            customPlaceholder="Regular expression"
            onChange={(pattern) => patchValidation({ pattern })}
          />
        </div>
      );

    case 'PHONE':
      return (
        <PatternField
          label="Format"
          pattern={v.pattern}
          presets={PHONE_PATTERN_PRESETS}
          customPlaceholder="Regular expression"
          onChange={(pattern) => patchValidation({ pattern })}
        />
      );

    case 'NUMBER':
      return (
        <div className="flex flex-wrap items-end gap-3">
          <NumberField label="Min value" value={v.min} onChange={(n) => patchValidation({ min: n })} />
          <NumberField label="Max value" value={v.max} onChange={(n) => patchValidation({ max: n })} />
        </div>
      );

    case 'MULTI_CHOICE':
      return (
        <div className="flex flex-wrap items-end gap-3">
          <NumberField
            label="Min selections"
            value={v.min}
            min={0}
            onChange={(n) => patchValidation({ min: n })}
          />
          <NumberField
            label="Max selections"
            value={v.max}
            min={0}
            onChange={(n) => patchValidation({ max: n })}
          />
        </div>
      );

    case 'STAR_RATING':
      return (
        <NumberField
          label="Number of stars"
          value={v.max ?? 5}
          min={2}
          max={10}
          onChange={(n) => patchValidation({ max: n ?? 5 })}
        />
      );

    case 'SLIDER':
      return (
        <div className="flex flex-wrap items-end gap-3">
          <NumberField
            label="Min"
            value={question.sliderMin ?? 0}
            onChange={(n) => onPatch({ sliderMin: n ?? 0 })}
          />
          <NumberField
            label="Max"
            value={question.sliderMax ?? 100}
            onChange={(n) => onPatch({ sliderMax: n ?? 100 })}
          />
          <NumberField
            label="Step"
            value={question.sliderStep ?? 1}
            min={1}
            onChange={(n) => onPatch({ sliderStep: n ?? 1 })}
          />
        </div>
      );

    case 'FILE_UPLOAD':
      return (
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Allowed types</Label>
            <Input
              value={v.allowedTypes?.join(', ') ?? ''}
              onChange={(e) => {
                const types = e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .slice(0, 50);
                patchValidation({ allowedTypes: types.length ? types : undefined });
              }}
              placeholder="jpg, png, pdf"
              className="h-7 w-44 text-[11px]"
            />
          </div>
          <NumberField
            label="Max size (MB)"
            value={v.maxSizeMb}
            min={1}
            onChange={(n) => patchValidation({ maxSizeMb: n })}
          />
        </div>
      );

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared controls
// ─────────────────────────────────────────────────────────────────────────────

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value?: number;
  min?: number;
  max?: number;
  onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        onChange={(e) => {
          if (e.target.value === '') {
            onChange(undefined);
            return;
          }
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? n : undefined);
        }}
        onClick={(e) => e.stopPropagation()}
        className="tabular h-7 w-20 text-[11px]"
      />
    </div>
  );
}

interface PatternPreset {
  value: string;
  label: string;
}

const TEXT_PATTERN_PRESETS: PatternPreset[] = [
  { value: '', label: 'Any text' },
  { value: '^[A-Za-z\\s]+$', label: 'Letters only' },
  { value: '^[0-9]+$', label: 'Numbers only' },
  { value: '^[A-Za-z0-9\\s]+$', label: 'Letters & numbers' },
];

const PHONE_PATTERN_PRESETS: PatternPreset[] = [
  { value: '', label: 'Any valid phone number' },
  { value: '^[0-9]{10}$', label: 'Exactly 10 digits' },
];

/**
 * A dropdown of common patterns, plus an escape hatch for anything else.
 *
 * The escape hatch is tracked as local UI state rather than derived purely
 * from `pattern`, so choosing "Custom pattern…" with nothing typed yet still
 * shows the text box instead of snapping back to "Any text" the moment the
 * field is empty.
 */
function PatternField({
  label,
  pattern,
  presets,
  customPlaceholder,
  onChange,
}: {
  label: string;
  pattern?: string;
  presets: PatternPreset[];
  customPlaceholder: string;
  onChange: (pattern: string | undefined) => void;
}) {
  const presetValues = new Set(presets.map((p) => p.value));
  const [customMode, setCustomMode] = useState(() => !!pattern && !presetValues.has(pattern));

  const selectValue = customMode ? 'custom' : pattern ?? '';

  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={label}
          value={selectValue}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            if (e.target.value === 'custom') {
              setCustomMode(true);
              return;
            }
            setCustomMode(false);
            onChange(e.target.value || undefined);
          }}
          className="h-7 rounded-md border border-border bg-background px-1.5 text-[11px]
                     text-muted-foreground hover:border-border-strong focus-visible:outline-none"
        >
          {presets.map((preset) => (
            <option key={preset.value || 'any'} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="custom">Custom pattern…</option>
        </select>
        {customMode && (
          <Input
            value={pattern ?? ''}
            onChange={(e) => onChange(e.target.value || undefined)}
            onClick={(e) => e.stopPropagation()}
            placeholder={customPlaceholder}
            className="h-7 w-40 text-[11px]"
          />
        )}
      </div>
    </div>
  );
}
