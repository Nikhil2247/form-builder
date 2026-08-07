'use client';

import React from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Copy-to-clipboard with a confirmation state.
 *
 * `navigator.clipboard` is undefined on insecure origins and can reject when
 * the document is not focused; the call sites that used it bare (share links,
 * webhook secrets, embed code) failed silently, leaving the user believing they
 * had copied something. This falls back and always reports the outcome.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  size = 'sm',
  variant = 'outline',
  iconOnly,
  className,
}: {
  value: string;
  label?: string;
  copiedLabel?: string;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'ghost' | 'secondary';
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async () => {
    const ok = await writeToClipboard(value);
    if (ok) {
      setCopied(true);
    } else {
      toast.error('Could not copy — select the text and copy manually.');
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? 'icon-sm' : size}
      onClick={handleCopy}
      className={cn(!iconOnly && 'gap-1.5', className)}
      aria-label={iconOnly ? (copied ? copiedLabel : label) : undefined}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      {!iconOnly && (copied ? copiedLabel : label)}
      {/* Announce the result to screen readers, which see no visual change. */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </Button>
  );
}

/** Read-only field with an inline copy affordance — share links, secrets, IDs. */
export function CopyField({
  value,
  label,
  description,
  monospace = true,
  masked,
  className,
}: {
  value: string;
  label?: string;
  description?: string;
  monospace?: boolean;
  /** Renders dots until revealed. For secrets. */
  masked?: boolean;
  className?: string;
}) {
  const [revealed, setRevealed] = React.useState(!masked);

  return (
    <div className={cn('space-y-1.5', className)}>
      {label && <span className="block text-xs font-medium text-foreground">{label}</span>}
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={revealed ? value : '•'.repeat(Math.min(value.length, 40))}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            'h-9 min-w-0 flex-1 rounded-md border border-input bg-muted/40 px-3 text-sm text-foreground',
            monospace && 'font-mono text-xs',
          )}
        />
        {masked && (
          <Button variant="ghost" size="sm" onClick={() => setRevealed((r) => !r)}>
            {revealed ? 'Hide' : 'Reveal'}
          </Button>
        )}
        <CopyButton value={value} iconOnly />
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}
