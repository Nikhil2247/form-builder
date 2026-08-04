import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ProfileSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Profile</h3>
        <p className="text-sm text-muted-foreground">
          This is how others will see you on the site.
        </p>
      </div>
      <div className="space-y-8">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input id="name" defaultValue="John Doe" />
          <p className="text-[10px] text-muted-foreground">
            This is your public display name.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" defaultValue="john@example.com" disabled />
          <p className="text-[10px] text-muted-foreground">
            Your email is managed by your organization.
          </p>
        </div>
        <Button>Update profile</Button>
      </div>
    </div>
  );
}
