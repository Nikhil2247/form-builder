'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, Loader2, Search } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useChoiceItems, type ChoiceItem } from '@/hooks/use-choice-items';
import { cn } from '@/lib/utils';
import type { FormQuestion } from '@/types/form';

/**
 * A choice question whose options come from a managed list.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two presentations, chosen by size rather than by author preference:
 *
 *   • a plain `<select>` (or checkbox group) when the option set is small — a
 *     native control is faster, works on every device, and needs no
 *     accessibility work of its own;
 *   • a searchable listbox once it is not — 784 districts in a `<select>` is
 *     technically valid and practically unusable, and a school registry cannot
 *     be sent to the browser at all.
 *
 * ── The empty state is the important one ───────────────────────────────────
 * A cascading question before its parent is answered must SAY so. Rendering an
 * empty dropdown is the single most confusing thing this control could do — the
 * respondent has no way to know whether the list is loading, broken, or waiting
 * on them.
 */

export interface ChoiceListFieldProps {
  question: FormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  /** Public form slug; absent in the builder preview. */
  formSlug?: string;
  /** The parent question's current answer, when this one cascades. */
  parentValue?: string;
  /** Human label of the parent question, for the waiting message. */
  parentLabel?: string;
  controlId: string;
  labelId: string;
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
}

/** Above this, a native select stops being a reasonable control. */
const SEARCHABLE_THRESHOLD = 30;

function displayLabel(item: ChoiceItem, displayField?: string): string {
  if (displayField && item.metadata) {
    const alternative = item.metadata[displayField];
    if (typeof alternative === 'string' && alternative) return alternative;
  }
  return item.label;
}

export function ChoiceListField({
  question,
  value,
  onChange,
  onBlur,
  formSlug,
  parentValue,
  parentLabel,
  controlId,
  labelId,
  describedBy,
  invalid,
  required,
}: ChoiceListFieldProps) {
  const source = question.optionsSource;
  const isMulti = question.type === 'MULTI_CHOICE';
  const [search, setSearch] = React.useState('');

  const { items, isLoading, error, awaitingParent } = useChoiceItems({
    formSlug,
    question,
    parentValue,
    search,
  });

  const searchable = (source?.searchable ?? false) || items.length >= SEARCHABLE_THRESHOLD || !!search;

  // ── States that are not "here are your options" ──────────────────────────
  if (!formSlug) {
    // The builder preview holds no published slug, so there is nothing to query.
    // Saying so beats an empty control the author will read as a bug.
    return (
      <Notice id={describedBy}>
        Options come from the <strong>{source?.listSlug}</strong> list. They appear on the published
        form.
      </Notice>
    );
  }

  if (awaitingParent) {
    return (
      <Notice id={describedBy}>
        Choose {parentLabel ? <strong>{parentLabel}</strong> : 'the question above'} first.
      </Notice>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-sm font-semibold text-destructive">
        {error}
      </p>
    );
  }

  if (isLoading && items.length === 0) {
    return (
      <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading options…
      </div>
    );
  }

  if (items.length === 0 && !search) {
    return <Notice id={describedBy}>No options are available for this question yet.</Notice>;
  }

  // ── Multi-select ─────────────────────────────────────────────────────────
  if (isMulti) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="space-y-3" aria-describedby={describedBy} aria-invalid={invalid || undefined}>
        <legend className="sr-only">{question.label} — choose one or more</legend>
        {searchable && (
          <SearchBox value={search} onChange={setSearch} label={question.label} loading={isLoading} />
        )}
        <div className={cn('space-y-3', searchable && 'max-h-64 overflow-y-auto pr-1')}>
          {items.map((item) => (
            <div key={item.id} className="flex items-center space-x-3">
              <Checkbox
                id={`c-${question.id}-${item.value}`}
                checked={selected.includes(item.value)}
                onCheckedChange={(checked) =>
                  onChange(
                    checked === true
                      ? [...selected, item.value]
                      : selected.filter((entry) => entry !== item.value),
                  )
                }
              />
              <Label
                htmlFor={`c-${question.id}-${item.value}`}
                className="cursor-pointer font-normal"
              >
                {displayLabel(item, source?.displayField)}
              </Label>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground">No options match “{search}”.</p>
          )}
        </div>
      </fieldset>
    );
  }

  // ── Single select, small list: a native control ──────────────────────────
  if (!searchable) {
    return (
      <select
        id={controlId}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={required || undefined}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">Select an option…</option>
        {items.map((item) => (
          <option key={item.id} value={item.value}>
            {displayLabel(item, source?.displayField)}
          </option>
        ))}
      </select>
    );
  }

  // ── Single select, large list: searchable listbox ────────────────────────
  return (
    <SearchableSelect
      items={items}
      value={typeof value === 'string' ? value : ''}
      onChange={onChange}
      onBlur={onBlur}
      search={search}
      onSearch={setSearch}
      loading={isLoading}
      displayField={source?.displayField}
      question={question}
      controlId={controlId}
      labelId={labelId}
      describedBy={describedBy}
      invalid={invalid}
      required={required}
    />
  );
}

function Notice({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p
      id={id}
      role="status"
      className="flex max-w-md items-center rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
    >
      {children}
    </p>
  );
}

function SearchBox({
  value,
  onChange,
  label,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  loading: boolean;
}) {
  return (
    <div className="relative max-w-md">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type to search…"
        aria-label={`Search ${label}`}
        className="bg-background pl-9"
      />
      {loading && (
        <Loader2
          className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
    </div>
  );
}

/**
 * A combobox over a large, server-filtered list.
 *
 * Built on the ARIA 1.2 combobox pattern rather than a `<select>`: the option
 * set is fetched as the respondent types, which a native select cannot express.
 * The trigger owns `aria-expanded` and `aria-controls`, the list is a real
 * `listbox`, and `aria-activedescendant` moves with the arrow keys so the
 * focused option is announced without focus ever leaving the input.
 */
function SearchableSelect({
  items,
  value,
  onChange,
  onBlur,
  search,
  onSearch,
  loading,
  displayField,
  question,
  controlId,
  labelId,
  describedBy,
  invalid,
  required,
}: {
  items: ChoiceItem[];
  value: string;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  displayField?: string;
  question: FormQuestion;
  controlId: string;
  labelId: string;
  describedBy?: string;
  invalid?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  // The highlighted option must return to the top whenever the result set
  // changes, or an arrow-key position from a previous search points at an
  // unrelated row. Stored WITH the result set it was measured against and
  // derived on read, rather than reset by an effect — an effect would render
  // once with the stale index before correcting it.
  const [active, setActive] = React.useState({ token: '', index: 0 });
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const listId = `${controlId}-listbox`;

  // The popup is PORTALLED, because every question sits inside a `Card` and
  // that Card is `overflow-hidden`. An absolutely-positioned list is clipped by
  // it — the options rendered, then got sliced off at the card's edge, which is
  // exactly what a respondent sees as "the dropdown is broken". No amount of
  // z-index fixes a clip; the element has to leave the subtree.
  const anchor = useAnchorRect(containerRef, open);

  const selected = items.find((item) => item.value === value);
  // The chosen item may not be in the current (searched or paged) result set,
  // so the trigger falls back to the raw value rather than going blank — a
  // control that appears to forget the answer is worse than an unlovely one.
  const selectedLabel = selected ? displayLabel(selected, displayField) : value;

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        onBlur();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onBlur]);

  const resultToken = `${search}|${items.length}`;
  const activeIndex = active.token === resultToken ? active.index : 0;
  const setActiveIndex = (next: number) => setActive({ token: resultToken, index: next });

  const commit = (item: ChoiceItem) => {
    onChange(item.value);
    onSearch('');
    setOpen(false);
    onBlur();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(Math.min(Math.max(activeIndex + delta, 0), Math.max(items.length - 1, 0)));
      return;
    }
    if (event.key === 'Enter' && open) {
      const item = items[activeIndex];
      if (item) {
        event.preventDefault();
        commit(item);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative max-w-md">
      {open ? (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={controlId}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            aria-required={required || undefined}
            autoFocus
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Search ${question.label.toLowerCase()}…`}
            className="bg-background pl-9"
          />
          {loading && (
            <Loader2
              className="absolute right-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
              aria-hidden
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          id={controlId}
          role="combobox"
          aria-expanded={false}
          aria-controls={listId}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            'flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-left text-sm',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            !selectedLabel && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{selectedLabel || 'Select an option…'}</span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      )}

      {open &&
        anchor &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            // Fixed to the viewport at the trigger's measured position. The
            // theme variables do not inherit through a portal, so the popup
            // carries the ones it paints with.
            style={{
              position: 'fixed',
              top: anchor.openUpwards ? undefined : anchor.bottom + 4,
              bottom: anchor.openUpwards ? window.innerHeight - anchor.top + 4 : undefined,
              left: anchor.left,
              width: anchor.width,
              maxHeight: anchor.maxHeight,
              ...anchor.themeVars,
            }}
            // `text-card-foreground` is not decoration. A portalled element
            // inherits `color` from <body>, not from the theme scope it was
            // opened inside, so without this the options were painted in the
            // host page's text colour over the form's card colour — on the
            // public app page that came out as near-white on white.
            className="z-[100] overflow-y-auto rounded-[var(--radius)] border border-border bg-card py-1 text-card-foreground shadow-[0_16px_40px_-12px_rgba(0,0,0,.3)]"
          >
            {items.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">
                {loading ? 'Searching…' : `No options match “${search}”.`}
              </li>
            )}
            {items.map((item, index) => {
              const isSelected = item.value === value;
              return (
                <li
                  key={item.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    // mousedown, not click: the input's blur would close the
                    // list before a click ever landed.
                    event.preventDefault();
                    commit(item);
                  }}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm',
                    index === activeIndex && 'bg-muted',
                  )}
                >
                  <span className="truncate">{displayLabel(item, displayField)}</span>
                  {isSelected && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}

interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
  maxHeight: number;
  openUpwards: boolean;
  /** The form's palette, captured for the portalled popup. */
  themeVars: React.CSSProperties;
}

/**
 * Track the trigger's viewport position while the popup is open.
 *
 * Re-measured on scroll and resize (capture phase, so it catches scrolling
 * inside any ancestor, not just the window). Also decides which way to open:
 * a question near the bottom of a long form would otherwise drop its list off
 * the screen entirely.
 */
function useAnchorRect(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
): AnchorRect | null {
  const [rect, setRect] = React.useState<AnchorRect | null>(null);

  React.useEffect(() => {
    if (!open) return;

    const measure = () => {
      const element = ref.current;
      if (!element) return;
      const box = element.getBoundingClientRect();
      const spaceBelow = window.innerHeight - box.bottom;
      const spaceAbove = box.top;
      // Flip only when there is genuinely more room the other way, so the list
      // does not jitter between sides as the page scrolls.
      const openUpwards = spaceBelow < 200 && spaceAbove > spaceBelow;

      setRect({
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        maxHeight: Math.max(120, Math.min(288, (openUpwards ? spaceAbove : spaceBelow) - 16)),
        openUpwards,
        // Read here, in the effect, alongside the geometry — it is the same
        // single DOM read, and reading it during render would be reaching into
        // a ref at exactly the moment React tells you not to.
        themeVars: inheritedThemeVars(element),
      });
    };

    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [open, ref]);

  return open ? rect : null;
}

/**
 * The theme variables the popup needs, read off the element it is anchored to.
 *
 * A portal renders under `document.body`, outside `FormThemeScope`, so it
 * inherits none of the form's palette — an author's dark form would drop a
 * white list onto it. Copying the handful of tokens the popup paints with is
 * cheaper and far more predictable than portalling into the theme scope, which
 * would put it back inside the `overflow-hidden` card this exists to escape.
 */
function inheritedThemeVars(element: HTMLElement | null): React.CSSProperties {
  if (!element || typeof window === 'undefined') return {};
  const computed = window.getComputedStyle(element);
  const style: Record<string, string> = {};
  for (const name of [
    '--color-card',
    '--color-card-foreground',
    '--color-foreground',
    '--color-muted',
    '--color-muted-foreground',
    '--color-primary',
    '--color-border',
    '--radius',
  ]) {
    const value = computed.getPropertyValue(name);
    if (value) style[name] = value;
  }
  // The typeface too. A themed form in Outfit that drops an Inter list over
  // itself reads as a browser popup rather than as part of the form.
  const fontFamily = computed.getPropertyValue('font-family');
  if (fontFamily) style.fontFamily = fontFamily;

  return style as React.CSSProperties;
}
