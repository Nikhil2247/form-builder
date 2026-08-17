'use client';

import { isRichTextEmpty, sanitizeRichText } from '@/lib/rich-text';
import { cn } from '@/lib/utils';

/**
 * Render-only counterpart to `RichTextEditor`. Re-sanitizes at render time —
 * see `rich-text.ts` for why that, not the editor, is the real boundary.
 */
export function RichText({ html, className }: { html?: string | null; className?: string }) {
  if (isRichTextEmpty(html)) return null;

  return (
    <div
      className={cn(
        'text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-0.5',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: sanitizeRichText(html!) }}
    />
  );
}
