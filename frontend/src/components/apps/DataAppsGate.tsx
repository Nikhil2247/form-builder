'use client';

import React from 'react';
import { LayoutGrid } from 'lucide-react';
import { EmptyState, PageHeader, PageShell } from '@/components/shared';

/**
 * What every Data Apps page renders when the FORM_APPS flag is off.
 *
 * A flag is gating, never authorization (see use-features.ts): flipping it in
 * devtools would reveal these pages, and every request they make would still be
 * rejected by the API. What it buys is that an organization not using Data Apps
 * never sees a half-built surface — and that someone who lands here by an old
 * link gets an explanation instead of an empty table that looks broken.
 */
export function DataAppsDisabled({
  title = 'Data Apps',
  description = 'Subject records and data-entry apps.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <PageShell>
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={LayoutGrid}
        title="Data Apps are not enabled"
        description="This workspace does not have the Data Apps feature turned on. Ask a platform administrator to enable it for your organization."
      />
    </PageShell>
  );
}
