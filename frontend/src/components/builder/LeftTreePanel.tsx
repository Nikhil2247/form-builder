'use client';

import React, { useState } from 'react';
import {
  AlignLeft,
  Calendar,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Gauge,
  Grid,
  Hash,
  Heading,
  Link as LinkIcon,
  ListFilter,
  Mail,
  MapPin,
  PenTool,
  Phone,
  Plus,
  Sliders,
  Star,
  Type,
  UploadCloud,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useBuilderStore, useQuestionOutline } from '@/store/builder-store';
import type { QuestionType } from '@/types/form';

/**
 * Field palette and document outline.
 *
 * Reads selection and structure from the builder store rather than props, so
 * selecting a question re-renders this panel alone instead of the page and
 * every card beneath it.
 *
 * Two fixes worth calling out:
 *   • The outline hardcoded `[1, 2]` as the page list, so it always drew a
 *     "Page 2" (even for single-page forms) and never showed page 3 or beyond.
 *     It now walks the real pages.
 *   • Outline rows were `<div onClick>`, unreachable by keyboard. They are
 *     buttons now.
 */

interface LeftTreePanelProps {
  onAddQuestion: (type: QuestionType) => void;
  onAddPage: () => void;
  onClose?: () => void;
}

interface PaletteCategory {
  category: string;
  items: Array<{ type: QuestionType; label: string; icon: React.ElementType }>;
}

const CATEGORIZED_PALETTE: PaletteCategory[] = [
  {
    category: 'Basic',
    items: [
      { type: 'SHORT_TEXT', label: 'Short answer', icon: Type },
      { type: 'LONG_TEXT', label: 'Paragraph', icon: AlignLeft },
      { type: 'EMAIL', label: 'Email address', icon: Mail },
      { type: 'PHONE', label: 'Phone number', icon: Phone },
      { type: 'NUMBER', label: 'Number', icon: Hash },
      { type: 'URL', label: 'Website URL', icon: LinkIcon },
    ],
  },
  {
    category: 'Choice',
    items: [
      { type: 'SINGLE_CHOICE', label: 'Single choice', icon: CheckCircle2 },
      { type: 'MULTI_CHOICE', label: 'Multiple choice', icon: CheckSquare },
      { type: 'DROPDOWN', label: 'Dropdown', icon: ListFilter },
    ],
  },
  {
    category: 'Rating',
    items: [
      { type: 'STAR_RATING', label: 'Star rating', icon: Star },
      { type: 'NPS', label: 'NPS score', icon: Gauge },
      { type: 'SLIDER', label: 'Slider', icon: Sliders },
    ],
  },
  {
    category: 'Advanced',
    items: [
      { type: 'DATE', label: 'Date', icon: Calendar },
      { type: 'FILE_UPLOAD', label: 'File upload', icon: UploadCloud },
      { type: 'SIGNATURE', label: 'Signature', icon: PenTool },
      { type: 'MATRIX', label: 'Matrix / Likert', icon: Grid },
      { type: 'GPS_LOCATION', label: 'GPS location', icon: MapPin },
    ],
  },
  {
    category: 'Layout',
    items: [{ type: 'SECTION_HEADER', label: 'Section header', icon: Heading }],
  },
];

const TYPE_ICONS: Partial<Record<QuestionType, React.ElementType>> = {
  SINGLE_CHOICE: CheckCircle2,
  MULTI_CHOICE: CheckSquare,
  DROPDOWN: ListFilter,
  LONG_TEXT: AlignLeft,
  FILE_UPLOAD: UploadCloud,
  STAR_RATING: Star,
  NPS: Gauge,
  SLIDER: Sliders,
  SIGNATURE: PenTool,
  DATE: Calendar,
  MATRIX: Grid,
  GPS_LOCATION: MapPin,
  SECTION_HEADER: Heading,
  EMAIL: Mail,
  PHONE: Phone,
  NUMBER: Hash,
  URL: LinkIcon,
};

export function LeftTreePanel({ onAddQuestion, onAddPage, onClose }: LeftTreePanelProps) {
  const [activeTab, setActiveTab] = useState<'elements' | 'outline'>('elements');
  const [collapsedPages, setCollapsedPages] = useState<Record<number, boolean>>({});

  const outline = useQuestionOutline();
  const pages = useBuilderStore((s) => s.pages);
  const selectedQuestionId = useBuilderStore((s) => s.selectedQuestionId);
  const selectQuestion = useBuilderStore((s) => s.selectQuestion);

  const focusQuestion = (id: string) => {
    // `selectQuestion` may switch the active page (see builder-store), which
    // mounts a different set of cards. Deferred a frame so the query runs
    // against the page that is actually on screen after that switch, not the
    // one being navigated away from.
    selectQuestion(id);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-question-id="${id}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden border-r border-border bg-card">
      {onClose && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="Close panel"
          className="absolute right-2 top-2 z-10 md:hidden"
        >
          <X className="size-4" />
        </Button>
      )}

      <div role="tablist" className="flex border-b border-border bg-muted/30 text-xs font-medium">
        {(
          [
            ['elements', 'Fields'],
            ['outline', `Outline (${outline.length})`],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 border-b-2 px-3 py-2.5 text-center transition-colors',
              activeTab === tab
                ? 'border-foreground bg-background font-semibold text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-3">
        {activeTab === 'elements' ? (
          CATEGORIZED_PALETTE.map((group) => (
            <section key={group.category} className="space-y-1.5">
              <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.category}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.type}
                      onClick={() => onAddQuestion(item.type)}
                      className="flex w-full items-center gap-2.5 rounded-md border border-border bg-background
                                 p-1.5 text-left text-xs font-medium transition-colors
                                 hover:border-border-strong hover:bg-muted"
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
                        <Icon className="size-3.5" />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        ) : (
          <div className="space-y-3">
            {pages.map((page) => {
              const pageQuestions = outline.filter((q) => (q.pageNumber ?? 1) === page.pageNumber);
              const collapsed = collapsedPages[page.pageNumber] ?? false;

              return (
                <div key={page.pageNumber} className="space-y-1">
                  <button
                    onClick={() =>
                      setCollapsedPages((prev) => ({
                        ...prev,
                        [page.pageNumber]: !collapsed,
                      }))
                    }
                    aria-expanded={!collapsed}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs font-semibold
                               transition-colors hover:bg-muted"
                  >
                    {collapsed ? (
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="truncate">{page.title || `Page ${page.pageNumber}`}</span>
                    <span className="tabular ml-auto text-muted-foreground">
                      {pageQuestions.length}
                    </span>
                  </button>

                  {!collapsed && (
                    <ul className="space-y-0.5 border-l border-border pl-3">
                      {pageQuestions.length === 0 && (
                        <li className="px-2 py-1.5 text-[11px] text-muted-foreground">
                          No questions on this page
                        </li>
                      )}
                      {pageQuestions.map((question) => {
                        const Icon = TYPE_ICONS[question.type as QuestionType] ?? Type;
                        const isSelected = selectedQuestionId === question.id;

                        return (
                          <li key={question.id}>
                            <button
                              onClick={() => focusQuestion(question.id)}
                              aria-current={isSelected ? 'true' : undefined}
                              className={cn(
                                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                                isSelected
                                  ? 'bg-muted font-medium text-foreground'
                                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                              )}
                            >
                              <Icon className="size-3.5 shrink-0" />
                              <span className="truncate">{question.label || 'Untitled'}</span>
                              {question.required && (
                                <span
                                  aria-label="Required"
                                  title="Required"
                                  className="ml-auto text-destructive"
                                >
                                  *
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}

            <Button
              variant="outline"
              size="sm"
              onClick={onAddPage}
              className="w-full gap-1.5 border-dashed"
            >
              <Plus className="size-3.5" />
              Add page
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
