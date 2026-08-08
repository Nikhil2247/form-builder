'use client';

import React from 'react';
import { Building2, Loader2, ToggleLeft } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { PageHeader, PageShell, EmptyState, ErrorState, StatusBadge } from '@/components/shared';
import {
  useFeatureFlagsAdmin,
  useSetGlobalFeature,
  useSetOrganizationFeature,
  type FeatureFlagAdmin,
} from '@/hooks/use-features';

/**
 * Feature flag administration.
 *
 * Two levels, and the difference matters: the global default applies to every
 * organization that has no opinion of its own, while an override is a decision
 * recorded for one tenant. Clearing an override is therefore NOT the same as
 * turning it off — it returns that org to following the default.
 */
export default function PlatformFeaturesPage() {
  const { data: flags, isLoading, error, refetch } = useFeatureFlagsAdmin();
  const setGlobal = useSetGlobalFeature();
  const setForOrg = useSetOrganizationFeature();

  return (
    <PageShell>
      <PageHeader
        title="Features"
        description="Turn capabilities on for the whole platform, or for one organization at a time."
      />

      {error ? (
        <ErrorState title="Could not load features" error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
          Loading features…
        </div>
      ) : !flags?.length ? (
        <EmptyState
          icon={ToggleLeft}
          title="No features defined"
          description="Feature flags are seeded by migration. None are registered in this deployment."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {flags.map((flag) => (
            <FlagCard
              key={flag.key}
              flag={flag}
              isBusy={setGlobal.isPending || setForOrg.isPending}
              onToggleGlobal={(isEnabledGlobally) =>
                setGlobal.mutate({ key: flag.key, isEnabledGlobally })
              }
              onClearOverride={(orgId) =>
                setForOrg.mutate({ key: flag.key, orgId, isEnabled: null })
              }
              onSetOverride={(orgId, isEnabled) =>
                setForOrg.mutate({ key: flag.key, orgId, isEnabled })
              }
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

interface FlagCardProps {
  flag: FeatureFlagAdmin;
  isBusy: boolean;
  onToggleGlobal: (isEnabledGlobally: boolean) => void;
  onClearOverride: (orgId: string) => void;
  onSetOverride: (orgId: string, isEnabled: boolean) => void;
}

function FlagCard({
  flag,
  isBusy,
  onToggleGlobal,
  onClearOverride,
  onSetOverride,
}: FlagCardProps) {
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-foreground">{flag.name}</h2>
            <StatusBadge status={flag.isEnabledGlobally ? 'ACTIVE' : 'INACTIVE'} />
          </div>
          {flag.description && (
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{flag.description}</p>
          )}
          <code className="mt-2 inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            {flag.key}
          </code>
        </div>

        <label className="flex shrink-0 items-center gap-2.5">
          <span className="text-xs font-medium text-muted-foreground">Default</span>
          <Switch
            checked={flag.isEnabledGlobally}
            disabled={isBusy}
            onCheckedChange={(checked: boolean) => onToggleGlobal(checked)}
            aria-label={`${flag.name} enabled by default`}
          />
        </label>
      </div>

      {/* Per-organization overrides. Only rendered when some exist — an empty
          table here would imply configuration is missing rather than simply
          that every org follows the default. */}
      {flag.overrides.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Organization overrides
          </h3>
          <ul className="flex flex-col gap-2">
            {flag.overrides.map((override) => (
              <li
                key={override.organizationId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Building2 className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                  <span className="truncate text-sm">{override.organizationName}</span>
                </span>

                <span className="flex shrink-0 items-center gap-3">
                  <Switch
                    checked={override.isEnabled}
                    disabled={isBusy}
                    onCheckedChange={(checked: boolean) =>
                      onSetOverride(override.organizationId, checked)
                    }
                    aria-label={`${flag.name} for ${override.organizationName}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => onClearOverride(override.organizationId)}
                  >
                    {/* Not "Disable" — this removes the decision entirely, so the
                        org resumes following whatever the default becomes. */}
                    Use default
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
