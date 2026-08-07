'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Filter bar above a list. One layout, so every page's filters line up. */
export function Toolbar({
  children,
  end,
  className,
}: {
  children?: React.ReactNode;
  end?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {end && <div className="flex shrink-0 items-center gap-2">{end}</div>}
    </div>
  );
}

/**
 * Search box with a clear button.
 *
 * Keeps its own state so typing stays at 60fps, and reports upward on a debounce
 * — the previous implementation called `setSearch` on every keystroke, which on
 * the forms page re-ran the filter over the whole list and re-rendered every
 * card per character typed.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  debounceMs = 300,
  className,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  className?: string;
  'aria-label'?: string;
}) {
  const [draft, setDraft] = React.useState(value);
  const committed = React.useRef(value);

  // Adopt external changes (a filter reset, a back navigation) without
  // clobbering what the user is mid-way through typing.
  React.useEffect(() => {
    if (value !== committed.current) {
      committed.current = value;
      setDraft(value);
    }
  }, [value]);

  React.useEffect(() => {
    if (draft === committed.current) return;
    const timer = setTimeout(() => {
      committed.current = draft;
      onChange(draft);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [draft, debounceMs, onChange]);

  return (
    <div className={cn('relative', className)}>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm
                   placeholder:text-muted-foreground focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-ring sm:w-56
                   [&::-webkit-search-cancel-button]:appearance-none"
      />
      {draft && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            committed.current = '';
            onChange('');
          }}
          className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
        >
          <X className="size-3" />
        </Button>
      )}
    </div>
  );
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  label: string;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className={cn('h-9 w-auto min-w-32 text-sm', className)} aria-label={label}>
        <SelectValue placeholder={placeholder ?? label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
