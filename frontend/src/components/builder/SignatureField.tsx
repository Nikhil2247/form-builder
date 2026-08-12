'use client';

import React from 'react';
import SignatureCanvas from 'react-signature-canvas';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Signature capture.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Split out of `FormRunnerField` so that `react-signature-canvas` sits behind a
 * `next/dynamic` boundary. Every respondent to every public form used to
 * download the drawing library, whether or not the form had a signature
 * question; now only the forms that actually ask for one pay for it, and only
 * once the question is rendered.
 *
 * Keep this the module's default export — `dynamic()` resolves it by identity.
 *
 * ── Why there are two modes ────────────────────────────────────────────────
 * The canvas is mouse/touch only, which on its own makes any form carrying a
 * required signature impossible for a keyboard-only respondent to complete.
 * The typed alternative is the accessible equivalent — it produces the same
 * data-URL, rendered from text, so nothing downstream has to know which path
 * was used.
 */
export default function SignatureControl({
  value,
  onChange,
  labelId,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  labelId: string;
  describedBy?: string;
}) {
  const padRef = React.useRef<SignatureCanvas | null>(null);
  const [typed, setTyped] = React.useState('');
  const [mode, setMode] = React.useState<'draw' | 'type'>('draw');

  // The pad is uncontrolled and cannot be told to re-render an existing value,
  // so a restored draft or a step back would show an empty canvas beside a
  // stored answer. Clearing the stored value with it keeps the two honest.
  const clear = () => {
    padRef.current?.clear?.();
    setTyped('');
    onChange('');
  };

  const renderTyped = (text: string) => {
    setTyped(text);
    if (!text.trim()) {
      onChange('');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.font = 'italic 40px "Segoe Script", "Brush Script MT", cursive';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.slice(0, 40), canvas.width / 2, canvas.height / 2);
    onChange(canvas.toDataURL('image/png'));
  };

  return (
    <div className="space-y-3" role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
      <div className="flex gap-2" role="tablist" aria-label="Signature method">
        {(['draw', 'type'] as const).map((option) => (
          <Button
            key={option}
            type="button"
            role="tab"
            aria-selected={mode === option}
            variant={mode === option ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setMode(option);
              clear();
            }}
          >
            {option === 'draw' ? 'Draw signature' : 'Type signature'}
          </Button>
        ))}
      </div>

      {mode === 'draw' ? (
        <div className="max-w-[400px] overflow-hidden rounded-md border border-border bg-white">
          <SignatureCanvas
            ref={padRef}
            penColor="black"
            canvasProps={{
              width: 400,
              height: 200,
              className: 'sigCanvas w-full h-[200px]',
              'aria-label': 'Signature drawing area. Switch to "Type signature" for a keyboard alternative.',
            }}
            onEnd={() => onChange(padRef.current?.toDataURL?.() ?? '')}
          />
        </div>
      ) : (
        <Input
          value={typed}
          onChange={(e) => renderTyped(e.target.value)}
          placeholder="Type your full name"
          autoComplete="name"
          maxLength={40}
          className="max-w-[400px] bg-background"
          aria-label="Type your signature"
        />
      )}

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          Clear signature
        </Button>
        <span className="text-xs text-muted-foreground" role="status">
          {value ? 'Signature captured' : 'No signature yet'}
        </span>
      </div>
    </div>
  );
}
