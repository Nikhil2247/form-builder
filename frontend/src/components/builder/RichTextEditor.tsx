'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bold, Italic, Link2, List, ListOrdered, Underline } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isRichTextEmpty, sanitizeRichText } from '@/lib/rich-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** Debounce before typed changes reach `onChange`. Toolbar actions bypass it. */
  debounceMs?: number;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * A small formatting toolbar (bold/italic/underline/lists/link) over a
 * contentEditable div.
 *
 * Deliberately uncontrolled-ish: the DOM is only resynced from `value` when
 * that value did not come from this component's own last emission (an
 * external change — loading a different form/page). Making it fully
 * controlled — rewriting `innerHTML` on every keystroke — resets the caret to
 * the start of the field on every character, which is the standard
 * contentEditable/React trap.
 *
 * ── Why the initial content is set imperatively, not via
 *    `dangerouslySetInnerHTML` ────────────────────────────────────────────
 * The previous version froze the sanitized initial HTML into a `useRef` and
 * passed it to `dangerouslySetInnerHTML` so React would only write it once.
 * That ref's initializer ran during render — including any server render —
 * where `sanitizeRichText` has no `window` to parse with and always returns
 * `''`, regardless of what `value` actually held. An effect never runs on the
 * server at all, so doing the initial write there instead removes that
 * ambiguity entirely: this component only ever touches the DOM from client
 * code that is guaranteed to have a real `window`.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className,
  debounceMs = 300,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  // `null` is a sentinel meaning "not yet synced to the DOM" — distinct from
  // every real value, including `''`, so the first run of the sync effect
  // below always fires and writes the initial content.
  const lastEmittedRef = useRef<string | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isEmpty, setIsEmpty] = useState(() => isRichTextEmpty(value));
  const [isFocused, setIsFocused] = useState(false);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const commitNow = useCallback(() => {
    // Whoever called this — the debounce firing on its own, a blur, a
    // toolbar action — there is no longer a pending edit once it runs. Nulled
    // rather than just cleared so a stale non-null id can never make the
    // unmount flush below think there is still something waiting.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const el = editorRef.current;
    if (!el) return;
    const clean = sanitizeRichText(el.innerHTML);
    lastEmittedRef.current = clean;
    setIsEmpty(isRichTextEmpty(clean));
    onChange(clean);
  }, [onChange]);

  // Runs once on mount (`lastEmittedRef.current` starts `null`) and again for
  // any later change to `value` that this component did not itself produce —
  // never fired for changes it just emitted, since `commitNow` updates the
  // ref before calling `onChange`. A layout effect, not a plain one, so an
  // existing description is in place before the browser paints rather than
  // flashing empty for a frame first.
  useLayoutEffect(() => {
    if (value === lastEmittedRef.current) return;
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = sanitizeRichText(value);
    lastEmittedRef.current = value;
    setIsEmpty(isRichTextEmpty(value));
    // Only re-run when `value` changes; `debounceMs` and `onChange`'s
    // identity are not part of that signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleInput = useCallback(() => {
    setIsEmpty(isRichTextEmpty(editorRef.current?.textContent ?? ''));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(commitNow, debounceMs);
  }, [commitNow, debounceMs]);

  // A pending debounced edit must be FLUSHED on unmount, not discarded. This
  // component unmounts routinely while the debounce is still pending — a
  // page tab switch filters its card out of the canvas, a section is on a
  // page the author just navigated away from — and the previous version's
  // cleanup only cleared the timer, silently dropping whatever was typed in
  // the last `debounceMs` before that happened.
  useEffect(() => {
    return () => {
      if (!debounceRef.current) return;
      clearTimeout(debounceRef.current);
      const el = editorRef.current;
      if (!el) return;
      const clean = sanitizeRichText(el.innerHTML);
      if (clean !== lastEmittedRef.current) onChange(clean);
    };
    // Intentionally runs only on unmount: this reads refs, not reactive
    // state, and re-subscribing on every `onChange` identity change would
    // flush the OLD closure's edit through the NEW one, out of order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mousedown + preventDefault keeps focus (and the live selection) inside
  // the editable while a toolbar button is pressed — a plain onClick blurs
  // the editor first, and execCommand then has nothing to act on.
  const runCommand = useCallback(
    (command: string, commandValue?: string) => (e: React.MouseEvent) => {
      e.preventDefault();
      document.execCommand(command, false, commandValue);
      commitNow();
    },
    [commitNow],
  );

  const openLinkPopover = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const sel = window.getSelection();
    savedRangeRef.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    setLinkUrl('');
    setLinkPopoverOpen(true);
  }, []);

  const applyLink = useCallback(() => {
    const editor = editorRef.current;
    const url = linkUrl.trim();
    if (!editor || !url) {
      setLinkPopoverOpen(false);
      return;
    }
    const href = normalizeUrl(url);

    editor.focus();
    const sel = window.getSelection();
    if (sel && savedRangeRef.current) {
      sel.removeAllRanges();
      sel.addRange(savedRangeRef.current);
    }

    if (sel && sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed) {
      document.execCommand('createLink', false, href);
    } else {
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.textContent = href;
      const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
      if (range) {
        range.deleteContents();
        range.insertNode(anchor);
        range.setStartAfter(anchor);
        range.collapse(true);
        sel!.removeAllRanges();
        sel!.addRange(range);
      } else {
        editor.appendChild(anchor);
      }
    }

    setLinkPopoverOpen(false);
    commitNow();
  }, [linkUrl, commitNow]);

  const toolbarButtons: Array<{
    key: string;
    label: string;
    icon: React.ElementType;
    onMouseDown: (e: React.MouseEvent) => void;
  }> = [
    { key: 'bold', label: 'Bold', icon: Bold, onMouseDown: runCommand('bold') },
    { key: 'italic', label: 'Italic', icon: Italic, onMouseDown: runCommand('italic') },
    { key: 'underline', label: 'Underline', icon: Underline, onMouseDown: runCommand('underline') },
    {
      key: 'bullet',
      label: 'Bullet list',
      icon: List,
      onMouseDown: runCommand('insertUnorderedList'),
    },
    {
      key: 'numbered',
      label: 'Numbered list',
      icon: ListOrdered,
      onMouseDown: runCommand('insertOrderedList'),
    },
  ];

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-0.5 border-b border-border pb-1.5">
        {toolbarButtons.map(({ key, label, icon: Icon, onMouseDown }) => (
          <Button
            key={key}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            title={label}
            onMouseDown={onMouseDown}
            className="text-muted-foreground hover:text-foreground"
          >
            <Icon className="size-3.5" />
          </Button>
        ))}

        <Popover open={linkPopoverOpen} onOpenChange={setLinkPopoverOpen}>
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Insert link"
                title="Insert link"
                onMouseDown={openLinkPopover}
                className="text-muted-foreground hover:text-foreground"
              >
                <Link2 className="size-3.5" />
              </Button>
            }
          />
          <PopoverContent className="w-64">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                applyLink();
              }}
              className="flex items-center gap-1.5"
            >
              <Input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com"
                aria-label="Link URL"
                className="h-8 text-xs"
              />
              <Button type="submit" size="sm" className="shrink-0">
                Add
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>

      <div className="relative">
        {isEmpty && !isFocused && placeholder && (
          <span className="pointer-events-none absolute left-0 top-0 text-sm text-muted-foreground">
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label={ariaLabel}
          onInput={handleInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            setIsFocused(false);
            commitNow();
          }}
          className="min-h-[1.5rem] text-sm leading-relaxed outline-none
                     [&_a]:text-primary [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-5
                     [&_ul]:list-disc [&_ul]:pl-5"
        />
      </div>
    </div>
  );
}
