'use client';

import React, { useState, useEffect } from 'react';
import { Globe, Save, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useUser } from '@/hooks/use-auth';
import { useOrganizationDetail, useUpdateOrganization } from '@/hooks/use-organization';

export default function OrganizationSettingsPage() {
  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;

  const { data: org, isLoading } = useOrganizationDetail(orgId);
  const updateOrg = useUpdateOrganization(orgId);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [website, setWebsite] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (org) {
      setName(org.name ?? '');
      setSlug(org.slug ?? '');
      setWebsite(org.website ?? '');
    }
  }, [org]);

  async function handleSave() {
    await updateOrg.mutateAsync({ name, slug, website });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="space-y-6 max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Organization</h2>
        <p className="text-sm text-muted-foreground mt-1">Update your organization profile and branding.</p>
      </div>

      <Card className="rounded-xl border border-border p-6 space-y-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/60 text-primary-foreground text-xl font-black shadow-md">
            {isLoading ? '?' : (org?.name?.charAt(0)?.toUpperCase() ?? 'O')}
          </div>
          <div>
            {isLoading ? (
              <><Skeleton className="h-4 w-32 mb-1" /><Skeleton className="h-3 w-24" /></>
            ) : (
              <><p className="text-sm font-semibold text-foreground">{org?.name}</p><p className="text-xs text-muted-foreground">{org?.slug}</p></>
            )}
          </div>
        </div>

        <div className="space-y-4 pt-2 border-t border-border">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Organization Name</label>
            {isLoading ? <Skeleton className="h-9 rounded-lg" /> : <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Slug</label>
            <div className="flex items-center">
              <span className="flex h-9 items-center rounded-l-lg border border-r-0 border-border bg-muted px-3 text-sm text-muted-foreground">formbuilder.app/</span>
              {isLoading ? <Skeleton className="h-9 flex-1 rounded-r-lg" /> : <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-corp" className="rounded-l-none" />}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium flex items-center gap-1.5"><Globe size={13} />Website (optional)</label>
            {isLoading ? <Skeleton className="h-9 rounded-lg" /> : <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://yourcompany.com" type="url" />}
          </div>
        </div>
      </Card>

      <Card className="rounded-xl border border-destructive/30 p-6 space-y-3">
        <h3 className="text-sm font-semibold text-destructive">Danger Zone</h3>
        <p className="text-xs text-muted-foreground">Deleting your organization will permanently remove all forms and data. This cannot be undone.</p>
        <Button variant="outline" size="sm" className="border-destructive/50 text-destructive hover:bg-destructive/10">Delete Organization</Button>
      </Card>

      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleSave} disabled={updateOrg.isPending || isLoading} className="gap-2">
          {updateOrg.isPending ? <><Loader2 size={14} className="animate-spin" />Saving...</> : saved ? <><CheckCircle2 size={14} />Saved!</> : <><Save size={14} />Save Changes</>}
        </Button>
      </div>
    </div>
  );
}
