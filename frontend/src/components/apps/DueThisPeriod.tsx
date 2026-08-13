'use client';

import React from 'react';
import Link from 'next/link';
import { CalendarClock, CheckCircle2, ChevronRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAppDue, type FormAppStep } from '@/hooks/use-form-apps';

/**
 * Who still needs recording — the daily work queue.
 *
 * ── Why there is no count, and never will be ───────────────────────────────
 * "342 students due" needs a COUNT over an anti-join, which has to probe every
 * record in the organization before it can answer. The list below stops as soon
 * as it has ten rows. The number is the expensive part; the rows are cheap.
 *
 * A queue is worked from the top, so the number was never the point — and a
 * panel that appears instantly beats one that appears with a total. "10 shown"
 * plus a link onward is the honest presentation of what was actually computed.
 */
export function DueThisPeriod({
  appId,
  steps,
  publicSlug,
}: {
  appId: string;
  steps: FormAppStep[];
  publicSlug: string | null;
}) {
  // Only per-record steps can be outstanding. A SESSION-scoped step's count
  // lives inside one sitting, so it has no per-record notion of missing — the
  // API rejects the question rather than answering it misleadingly.
  const trackable = steps.filter(
    (step) => step.scope === 'SUBJECT' || step.scope === 'SUBJECT_PERIOD',
  );

  const [stepKey, setStepKey] = React.useState<string>('');
  const selected = stepKey || trackable[0]?.key || '';

  const due = useAppDue(appId, selected || undefined);

  // Nothing in this app is counted per record, so nothing can be outstanding.
  // Absent rather than empty: a permanently blank panel reads as broken.
  if (trackable.length === 0) return null;

  const records = due.data?.records ?? [];

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 text-muted-foreground" strokeWidth={1.5} />
            Still to record
          </h2>
          {due.data?.period && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {due.data.period.label}
            </p>
          )}
        </div>

        {trackable.length > 1 && (
          <NativeSelect
            aria-label="Step to check"
            className="w-auto"
            value={selected}
            onChange={(e) => setStepKey(e.target.value)}
          >
            {trackable.map((step) => (
              <option key={step.key} value={step.key}>
                {step.title}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      {due.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 rounded-lg" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-primary" strokeWidth={1.5} />
          Every record has this one.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {records.map((record) => (
              <li key={record.id} className="flex items-center gap-3 py-2">
                <Link
                  href={`/records/${record.id}`}
                  className="min-w-0 flex-1 truncate text-sm font-medium hover:underline"
                >
                  {record.displayName}
                </Link>
                {record.externalId && (
                  <span className="tabular shrink-0 text-xs text-muted-foreground">
                    {record.externalId}
                  </span>
                )}
                {publicSlug && (
                  <a
                    href={
                      `/a/${publicSlug}?subject=${encodeURIComponent(record.id)}` +
                      `&step=${encodeURIComponent(selected)}`
                    }
                    className="shrink-0 text-xs font-medium text-primary underline underline-offset-4"
                  >
                    Record
                  </a>
                )}
              </li>
            ))}
          </ul>

          {/* "10 shown" rather than "10 of 342": ten is what was computed, and
              claiming a total the query never produced would be a fiction. */}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {records.length} shown
            {due.data?.nextCursor && (
              <>
                <ChevronRight className="size-3" strokeWidth={1.5} />
                more outstanding
              </>
            )}
          </p>
        </>
      )}
    </Card>
  );
}
