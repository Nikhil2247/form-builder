'use client';

import React from 'react';
import Link from 'next/link';
import { Bell, Mail } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader, PageShell, EmptyState, ButtonLink } from '@/components/shared';

/**
 * Notifications.
 *
 * There is no notifications module in the API yet (it is Phase 4 in the
 * roadmap). This page previously rendered three hardcoded entries — "Sarah
 * joined your organization as an Editor", a submission on a form that may not
 * exist — presented as if they were real. Fabricated activity is worse than an
 * empty page: a user acts on it.
 *
 * The honest state is shown instead, along with the notification channel that
 * genuinely works today (per-form email recipients).
 */
export default function NotificationsPage() {
  return (
    <PageShell width="narrow">
      <PageHeader
        title="Notifications"
        description="Alerts about your forms and organization."
      />

      <EmptyState
        icon={Bell}
        title="No in-app notifications yet"
        description="In-app notifications are not available on this deployment. Response alerts are delivered by email instead."
      />

      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Mail className="size-4" strokeWidth={1.5} />
          </span>
          <div>
            <h2 className="text-sm font-medium">Email notifications</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Each form can email a list of recipients whenever it receives a response. Configure
              the recipients in that form&apos;s settings.
            </p>
          </div>
        </div>
        <ButtonLink variant="outline" size="sm" href="/forms">
          Go to forms
        </ButtonLink>
      </Card>
    </PageShell>
  );
}
