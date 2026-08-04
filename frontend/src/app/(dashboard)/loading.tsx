import React from 'react';

export default function DashboardLoading() {
  return (
    <div className="w-full space-y-6 p-4 sm:p-6 lg:p-8 animate-pulse">
      {/* Page header skeleton */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-lg bg-muted" />
          <div className="h-4 w-72 rounded-md bg-muted/70" />
        </div>
        <div className="h-9 w-28 rounded-lg bg-muted" />
      </div>

      {/* Stats grid skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
