'use client';

import React from 'react';
import { Check, Image as ImageIcon, Trash2, Type } from 'lucide-react';
import { FormConfig, FormTheme, ThemePreset } from '@/types/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { PanelBlock, PanelRow, PanelSection } from './panel-primitives';
import { cardVariantClass } from './FormThemeScope';

/**
 * Theme editor.
 *
 * Lives inside the settings dialog now, as its Design tab, rather than behind a
 * navbar button of its own. That move is why the layout changed: it was built
 * for a wide standalone surface — a hero card with a 48px icon, a three-column
 * preset grid, `p-6` cards and a `max-w-4xl` inner wrapper — none of which fits
 * a dialog column, and none of which matched the density of the settings it now
 * sits beside. It is rebuilt from the shared panel primitives, so it inherits
 * the same card padding, heading scale and row rhythm as every other tab.
 */

interface ThemeCustomizerProps {
  form: FormConfig;
  setForm: React.Dispatch<React.SetStateAction<FormConfig>>;
}

const PRESETS: Array<{
  id: ThemePreset;
  name: string;
  primary: string;
  bg: string;
  card: string;
  text: string;
}> = [
  { id: 'slate', name: 'Slate', primary: '#18181b', bg: '#ffffff', card: '#ffffff', text: '#18181b' },
  { id: 'indigo', name: 'Indigo', primary: '#4f46e5', bg: '#f8fafc', card: '#ffffff', text: '#0f172a' },
  { id: 'emerald', name: 'Emerald', primary: '#059669', bg: '#f0fdf4', card: '#ffffff', text: '#064e3b' },
  { id: 'sunset', name: 'Sunset', primary: '#ea580c', bg: '#fff7ed', card: '#ffffff', text: '#431407' },
  { id: 'midnight', name: 'Midnight', primary: '#6366f1', bg: '#090d16', card: '#111827', text: '#f9fafb' },
  { id: 'glass', name: 'Glass', primary: '#8b5cf6', bg: '#f3e8ff', card: 'rgba(255, 255, 255, 0.75)', text: '#3b0764' },
  { id: 'neon', name: 'Neon', primary: '#ec4899', bg: '#0f0f1a', card: '#1a1a2e', text: '#f472b6' },
];

const FONTS: Array<{ value: FormTheme['fontFamily']; label: string }> = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Outfit', label: 'Outfit' },
  { value: 'Plus Jakarta Sans', label: 'Plus Jakarta Sans' },
];

const RADII: Array<{ value: FormTheme['borderRadius']; label: string }> = [
  { value: 'none', label: 'Square' },
  { value: 'sm', label: 'Slight' },
  { value: 'md', label: 'Rounded' },
  { value: 'lg', label: 'Soft' },
  { value: 'full', label: 'Pill' },
];

const CARD_VARIANTS: Array<{ value: FormTheme['cardVariant']; label: string }> = [
  { value: 'card', label: 'Bordered' },
  { value: 'elevated', label: 'Elevated' },
  { value: 'glass', label: 'Glass' },
  { value: 'minimal', label: 'Minimal' },
];

const RADIUS_PX: Record<NonNullable<FormTheme['borderRadius']>, string> = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '16px',
  full: '9999px',
};

const SAMPLE_COVERS = [
  {
    label: 'Office',
    url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1200&auto=format&fit=crop',
  },
  {
    label: 'Gradient',
    url: 'https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=1200&auto=format&fit=crop',
  },
];

/** Colour picker plus its hex field, at the panel's control size. */
function ColorField({
  id,
  label,
  value,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  fallback: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-foreground">
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          type="color"
          // `<input type="color">` only accepts `#rrggbb`. Feeding it anything
          // else (a preset's `rgba(...)`, a half-typed hex) makes it silently
          // reset to black, which then writes black back on the next change.
          value={/^#[0-9a-f]{6}$/i.test(value ?? '') ? (value as string) : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
        />
        <Input
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} value`}
          placeholder={fallback}
          className="h-8 font-mono text-xs uppercase"
        />
      </div>
    </div>
  );
}

export function ThemeCustomizer({ form, setForm }: ThemeCustomizerProps) {
  const theme = (form.theme ?? {}) as FormTheme;

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setForm((prev) => ({
      ...prev,
      theme: {
        ...prev.theme,
        preset: preset.id,
        primaryColor: preset.primary,
        backgroundColor: preset.bg,
        cardColor: preset.card,
        textColor: preset.text,
      },
    }));
  };

  const update = (key: keyof FormTheme, value: string) => {
    setForm((prev) => ({ ...prev, theme: { ...prev.theme, [key]: value } }));
  };

  return (
    <div className="space-y-4">
      {/* ── Presets ────────────────────────────────────────────────────────── */}
      <PanelSection title="Palette" description="A starting point you can adjust below.">
        <PanelBlock>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PRESETS.map((preset) => {
              const isSelected = theme.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  aria-pressed={isSelected}
                  style={{ backgroundColor: preset.bg }}
                  className={cn(
                    'flex flex-col gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                    isSelected
                      ? 'border-foreground ring-1 ring-foreground'
                      : 'border-border hover:border-border-strong',
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-semibold" style={{ color: preset.text }}>
                      {preset.name}
                    </span>
                    {isSelected && (
                      <Check className="size-3 shrink-0" style={{ color: preset.text }} />
                    )}
                  </span>
                  <span className="flex items-center gap-1" aria-hidden>
                    {[preset.primary, preset.card, preset.bg].map((swatch, i) => (
                      <span
                        key={i}
                        className="size-3.5 rounded-full border border-black/10"
                        style={{ backgroundColor: swatch }}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </PanelBlock>
      </PanelSection>

      {/* ── Colours ────────────────────────────────────────────────────────── */}
      <PanelSection title="Colours">
        <PanelBlock>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ColorField
              id="theme-primary"
              label="Brand"
              value={theme.primaryColor}
              fallback="#4f46e5"
              onChange={(v) => update('primaryColor', v)}
            />
            <ColorField
              id="theme-background"
              label="Page background"
              value={theme.backgroundColor}
              fallback="#f8fafc"
              onChange={(v) => update('backgroundColor', v)}
            />
            <ColorField
              id="theme-card"
              label="Card"
              value={theme.cardColor}
              fallback="#ffffff"
              onChange={(v) => update('cardColor', v)}
            />
            <ColorField
              id="theme-text"
              label="Text"
              value={theme.textColor}
              fallback="#18181b"
              onChange={(v) => update('textColor', v)}
            />
          </div>
        </PanelBlock>
      </PanelSection>

      {/* ── Typography and shape ───────────────────────────────────────────── */}
      <PanelSection title="Typography and shape">
        <PanelRow icon={Type} title="Font" hint="Applied to the whole public form.">
          <NativeSelect
            className="w-full sm:w-48"
            aria-label="Font"
            value={theme.fontFamily ?? 'Inter'}
            onChange={(e) => update('fontFamily', e.target.value)}
          >
            {FONTS.map((font) => (
              <NativeSelectOption key={font.value} value={font.value}>
                {font.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </PanelRow>

        <PanelRow title="Corners" hint="Roundness of cards, inputs and buttons.">
          <NativeSelect
            className="w-full sm:w-48"
            aria-label="Corner radius"
            value={theme.borderRadius ?? 'md'}
            onChange={(e) => update('borderRadius', e.target.value)}
          >
            {RADII.map((radius) => (
              <NativeSelectOption key={radius.value} value={radius.value}>
                {radius.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </PanelRow>

        <PanelRow title="Card style" hint="How each question sits on the page.">
          <NativeSelect
            className="w-full sm:w-48"
            aria-label="Card style"
            value={theme.cardVariant ?? 'card'}
            onChange={(e) => update('cardVariant', e.target.value)}
          >
            {CARD_VARIANTS.map((variant) => (
              <NativeSelectOption key={variant.value} value={variant.value}>
                {variant.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </PanelRow>
      </PanelSection>

      {/* ── Cover ──────────────────────────────────────────────────────────── */}
      <PanelSection title="Cover image">
        <PanelBlock
          label="Image URL"
          htmlFor="theme-cover"
          hint="Shown as a banner above the form title."
        >
          <Input
            id="theme-cover"
            value={theme.coverImageUrl ?? ''}
            onChange={(e) => update('coverImageUrl', e.target.value)}
            placeholder="https://…"
            className="h-8 text-xs"
          />
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {SAMPLE_COVERS.map((sample) => (
              <Button
                key={sample.label}
                variant="outline"
                size="sm"
                onClick={() => update('coverImageUrl', sample.url)}
                className="gap-1.5"
              >
                <ImageIcon className="size-3.5" />
                {sample.label}
              </Button>
            ))}
            {theme.coverImageUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => update('coverImageUrl', '')}
                className="gap-1.5 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            )}
          </div>
        </PanelBlock>
      </PanelSection>

      {/* ── Preview ────────────────────────────────────────────────────────── */}
      <PanelSection title="Preview">
        <PanelBlock>
          <div
            className="rounded-lg border border-border p-3"
            style={{ backgroundColor: theme.backgroundColor || '#f8fafc' }}
          >
            <div
              className={cn('space-y-2 p-4', cardVariantClass(theme.cardVariant))}
              style={{
                backgroundColor: theme.cardColor || '#ffffff',
                color: theme.textColor || '#18181b',
                fontFamily: theme.fontFamily ?? 'Inter',
                borderRadius: RADIUS_PX[theme.borderRadius ?? 'md'],
                borderWidth: 1,
                borderStyle: 'solid',
              }}
            >
              <p className="text-sm font-semibold">How did we do?</p>
              <p className="text-xs opacity-70">This is how a question will look.</p>
              <span
                className="mt-1 inline-block px-3 py-1.5 text-xs font-semibold"
                style={{
                  backgroundColor: theme.primaryColor || '#4f46e5',
                  color: '#ffffff',
                  borderRadius: RADIUS_PX[theme.borderRadius ?? 'md'],
                }}
              >
                Submit
              </span>
            </div>
          </div>
        </PanelBlock>
      </PanelSection>
    </div>
  );
}
