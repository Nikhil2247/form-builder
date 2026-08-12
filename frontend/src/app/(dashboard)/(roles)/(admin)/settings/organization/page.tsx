'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared';
import { useOrganizationDetail, useUpdateOrganization } from '@/hooks/use-organization';

/** Mirrors the API's slug rule, so the error arrives before the round-trip. */
function validateSlug(slug: string): string | null {
  if (!slug.trim()) return 'A slug is required.';
  if (slug.length < 3) return 'Use at least 3 characters.';
  if (slug.length > 50) return 'Use at most 50 characters.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'Use lowercase letters, numbers, and single hyphens only.';
  }
  return null;
}

export default function OrganizationSettingsPage() {
  const { data: org, isLoading, error, refetch } = useOrganizationDetail();
  const updateOrg = useUpdateOrganization();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  useEffect(() => {
    if (!org) return;
    setName(org.name ?? '');
    setSlug(org.slug ?? '');
  }, [org]);

  const slugError = slug ? validateSlug(slug) : null;
  const dirty =
    !!org && (name !== (org.name ?? '') || slug !== (org.slug ?? ''));
  const canSave = dirty && !slugError && name.trim().length > 0;

  async function save() {
    try {
      await updateOrg.mutateAsync({ name: name.trim(), slug: slug.trim() });
      toast.success('Organization updated');
    } catch {
      // The catch is what stops a rejected save flashing a green "Saved"
      // confirmation; the toast itself comes from the global handler.
    }
  }

  if (error) {
    return <ErrorState title="Could not load your organization" error={error} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Organization profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The name and address respondents and team members see.
          </p>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Name</Label>
            {isLoading ? (
              <Skeleton className="h-9" />
            ) : (
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="org-slug">Slug</Label>
            {isLoading ? (
              <Skeleton className="h-9" />
            ) : (
              <div className="flex">
                <span className="flex h-9 shrink-0 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground">
                  /o/
                </span>
                <Input
                  id="org-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="acme-corp"
                  className="rounded-l-none"
                  aria-invalid={!!slugError}
                  aria-describedby={slugError ? 'org-slug-error' : undefined}
                />
              </div>
            )}
            {slugError && (
              <p id="org-slug-error" className="text-xs text-destructive">
                {slugError}
              </p>
            )}
          </div>

          {/* A "Website" field used to sit here. Organization has no such
              column, so the value was discarded on save and reloaded blank. */}
        </div>

        <div className="flex justify-end border-t border-border bg-muted/30 px-5 py-3">
          <Button size="sm" onClick={save} disabled={!canSave || updateOrg.isPending} className="gap-2">
            {updateOrg.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Save changes
          </Button>
        </div>
      </Card>
    </div>
  );
}
