'use client';

import React from 'react';
import { FormConfig, FormTheme, ThemePreset } from '@/types/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Palette, Check, Image as ImageIcon, Trash2 } from 'lucide-react';

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
  { id: 'indigo', name: 'Indigo Modern', primary: '#4f46e5', bg: '#f8fafc', card: '#ffffff', text: '#0f172a' },
  { id: 'emerald', name: 'Emerald Forest', primary: '#059669', bg: '#f0fdf4', card: '#ffffff', text: '#064e3b' },
  { id: 'sunset', name: 'Sunset Warmth', primary: '#ea580c', bg: '#fff7ed', card: '#ffffff', text: '#431407' },
  { id: 'midnight', name: 'Midnight Dark', primary: '#6366f1', bg: '#090d16', card: '#111827', text: '#f9fafb' },
  { id: 'glass', name: 'Glassmorphism', primary: '#8b5cf6', bg: '#f3e8ff', card: 'rgba(255, 255, 255, 0.75)', text: '#3b0764' },
  { id: 'neon', name: 'Neon Cyberpunk', primary: '#ec4899', bg: '#0f0f1a', card: '#1a1a2e', text: '#f472b6' }
];

export function ThemeCustomizer({ form, setForm }: ThemeCustomizerProps) {
  const currentTheme = form.theme || {};

  const handleApplyPreset = (preset: typeof PRESETS[0]) => {
    const updatedTheme: FormTheme = {
      ...currentTheme,
      preset: preset.id,
      primaryColor: preset.primary,
      backgroundColor: preset.bg,
      cardColor: preset.card,
      textColor: preset.text
    };
    setForm((prev) => ({ ...prev, theme: updatedTheme }));
  };

  const handleUpdateTheme = (key: keyof FormTheme, value: any) => {
    setForm((prev) => ({
      ...prev,
      theme: { ...prev.theme, [key]: value }
    }));
  };

  return (
    <div className="w-full space-y-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <Card className="p-6 shadow-sm border-border bg-card">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <Palette className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">
                Form Visual Design System
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Customize colors, card variants, fonts, and cover graphics to wow respondents.
              </p>
            </div>
          </div>
        </Card>

        {/* Presets Grid */}
        <Card className="p-6 shadow-sm border-border bg-card space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Curated Color Palette Presets</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {PRESETS.map((p) => {
              const isSelected = currentTheme.preset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => handleApplyPreset(p)}
                  className={`group relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'border-primary ring-2 ring-primary shadow-sm'
                      : 'border-border hover:border-primary/50'
                  }`}
                  style={{ backgroundColor: p.bg }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold" style={{ color: p.text }}>
                      {p.name}
                    </span>
                    {isSelected && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center gap-2">
                    <div className="h-5 w-5 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: p.primary }} />
                    <div className="h-5 w-5 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: p.card }} />
                    <div className="h-5 w-5 rounded-full border border-black/10 shadow-sm" style={{ backgroundColor: p.bg }} />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Customization Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Custom Colors */}
          <Card className="p-6 shadow-sm border-border bg-card space-y-5 text-sm">
            <h3 className="text-sm font-semibold text-foreground">Color Tokens</h3>

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">
                Primary Brand Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentTheme.primaryColor?.startsWith('#') ? currentTheme.primaryColor : '#4f46e5'}
                  onChange={(e) => handleUpdateTheme('primaryColor', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-border p-0.5 bg-background"
                />
                <Input
                  value={currentTheme.primaryColor || ''}
                  onChange={(e) => handleUpdateTheme('primaryColor', e.target.value)}
                  className="font-mono uppercase text-xs w-full"
                  placeholder="#4f46e5"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">
                Page Background Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={currentTheme.backgroundColor?.startsWith('#') ? currentTheme.backgroundColor : '#f8fafc'}
                  onChange={(e) => handleUpdateTheme('backgroundColor', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-border p-0.5 bg-background"
                />
                <Input
                  value={currentTheme.backgroundColor || ''}
                  onChange={(e) => handleUpdateTheme('backgroundColor', e.target.value)}
                  className="font-mono uppercase text-xs w-full"
                  placeholder="#f8fafc"
                />
              </div>
            </div>
          </Card>

          {/* Cover Header Image */}
          <Card className="p-6 shadow-sm border-border bg-card space-y-5 text-sm">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-primary" /> Cover Header Graphic
            </h3>

            <div className="space-y-1.5">
              <label className="font-medium text-foreground">
                Cover Image Banner URL
              </label>
              <Input
                value={currentTheme.coverImageUrl || ''}
                onChange={(e) => handleUpdateTheme('coverImageUrl', e.target.value)}
                placeholder="https://images.unsplash.com/..."
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleUpdateTheme(
                    'coverImageUrl',
                    'https://images.unsplash.com/photo-1522071820081-009f0129c71c?q=80&w=1200&auto=format&fit=crop'
                  )
                }
                className="text-xs"
              >
                Sample Office Cover
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleUpdateTheme(
                    'coverImageUrl',
                    'https://images.unsplash.com/photo-1557683316-973673baf926?q=80&w=1200&auto=format&fit=crop'
                  )
                }
                className="text-xs"
              >
                Gradient Abstract
              </Button>
              {currentTheme.coverImageUrl && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleUpdateTheme('coverImageUrl', '')}
                  className="gap-1 px-2"
                  title="Remove Image"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
