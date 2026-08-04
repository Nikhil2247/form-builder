import React from 'react';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from '@/components/ui/pagination';
import { cn } from '@/lib/utils';

interface DataTablePaginationProps {
  page: number;
  total: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function DataTablePagination({
  page,
  total,
  pageSize = 20,
  onPageChange,
  className,
}: DataTablePaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) return null;

  // Simple logic to show a few pages around the current page
  const getVisiblePages = () => {
    if (totalPages <= 5) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    
    if (page <= 3) return [1, 2, 3, 4, null, totalPages];
    if (page >= totalPages - 2) return [1, null, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    
    return [1, null, page - 1, page, page + 1, null, totalPages];
  };

  const pages = getVisiblePages();

  return (
    <div className={cn("flex items-center justify-between px-4 py-3 border-t border-border bg-card", className)}>
      <div className="text-xs text-muted-foreground">
        Showing <span className="font-medium text-foreground">{(page - 1) * pageSize + 1}</span> to{' '}
        <span className="font-medium text-foreground">{Math.min(page * pageSize, total)}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span> entries
      </div>
      
      <Pagination className="justify-end w-auto mx-0">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              onClick={(e) => {
                e.preventDefault();
                if (page > 1) onPageChange(page - 1);
              }}
              aria-disabled={page === 1}
              className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              text="" // Metronic uses icon only usually for compactness, or keep "Prev" if preferred. We set to "" to mimic square buttons.
            />
          </PaginationItem>
          
          {pages.map((p, i) => (
            <PaginationItem key={i}>
              {p === null ? (
                <PaginationEllipsis />
              ) : (
                <PaginationLink
                  isActive={page === p}
                  onClick={(e) => {
                    e.preventDefault();
                    onPageChange(p);
                  }}
                  className={cn(
                    "cursor-pointer w-8 h-8 rounded-md transition-colors",
                    page === p 
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 border-transparent" 
                      : "text-muted-foreground hover:bg-muted border-transparent"
                  )}
                >
                  {p}
                </PaginationLink>
              )}
            </PaginationItem>
          ))}

          <PaginationItem>
            <PaginationNext
              onClick={(e) => {
                e.preventDefault();
                if (page < totalPages) onPageChange(page + 1);
              }}
              aria-disabled={page === totalPages}
              className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              text=""
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
