'use client';

import { Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useBuilderStore, useQuestionOutline } from '@/store/builder-store';

/**
 * Switches which page the canvas shows and where new fields land.
 *
 * Only rendered by the caller once there is more than one page — a
 * single-page form has nothing for this bar to offer, and showing it anyway
 * would be a permanent empty tab strip above every simple form.
 */
export function PageTabsBar() {
  const pages = useBuilderStore((s) => s.pages);
  const activePage = useBuilderStore((s) => s.activePage);
  const addPage = useBuilderStore((s) => s.addPage);
  const deletePage = useBuilderStore((s) => s.deletePage);
  const setActivePage = useBuilderStore((s) => s.setActivePage);
  const outline = useQuestionOutline();

  const countByPage = new Map<number, number>();
  for (const row of outline) {
    countByPage.set(row.pageNumber, (countByPage.get(row.pageNumber) ?? 0) + 1);
  }

  return (
    <div
      role="tablist"
      aria-label="Form pages"
      className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1"
    >
      {pages.map((page) => {
        const isActive = page.pageNumber === activePage;
        return (
          <div
            key={page.pageNumber}
            role="tab"
            aria-selected={isActive}
            className={cn(
              'group/tab flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            <button
              type="button"
              onClick={() => setActivePage(page.pageNumber)}
              className="max-w-40 truncate"
            >
              {page.title || `Page ${page.pageNumber}`}
              <span className="tabular ml-1.5 text-muted-foreground">
                {countByPage.get(page.pageNumber) ?? 0}
              </span>
            </button>

            {pages.length > 1 && (
              <button
                type="button"
                title="Delete this page — its questions move to Page 1"
                aria-label={`Delete ${page.title || `Page ${page.pageNumber}`}`}
                onClick={() => {
                  deletePage(page.pageNumber);
                  if (activePage === page.pageNumber) {
                    setActivePage(useBuilderStore.getState().pages[0]?.pageNumber ?? 1);
                  }
                }}
                className="rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10
                           hover:text-destructive group-hover/tab:opacity-100"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Add page"
        title="Add page"
        onClick={() => setActivePage(addPage())}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
