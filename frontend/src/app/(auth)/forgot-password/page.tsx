'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Layers, ArrowLeft } from 'lucide-react';
import { useForgotPassword } from '@/hooks/use-auth';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const forgotPasswordMutation = useForgotPassword();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // No onError: the global handler in query-provider reports it, using the
    // API's own message where there is one. This handler used to replace that
    // with a flat "Failed to send reset link.", which hid the rate-limit
    // message the endpoint returns after five attempts — so a user who tripped
    // it was told the send had failed and kept retrying.
    forgotPasswordMutation.mutate(email, {
      onSuccess: () => {
        toast.success('If an account exists, a reset link was sent.');
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-2 text-center lg:text-left">
        <div className="flex lg:hidden justify-center mb-4 text-primary">
          <div className="bg-primary/10 p-3 rounded-2xl">
            <Layers size={32} />
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Forgot password?</h1>
        <p className="text-sm text-muted-foreground">
          No worries, we'll send you reset instructions.
        </p>
      </div>
      
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input 
            id="email" 
            placeholder="m@example.com" 
            type="email" 
            autoCapitalize="none" 
            autoComplete="email" 
            autoCorrect="off" 
            required 
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={forgotPasswordMutation.isPending}
          />
        </div>
        <Button className="w-full" type="submit" disabled={forgotPasswordMutation.isPending}>
          {forgotPasswordMutation.isPending ? 'Sending...' : 'Reset password'}
        </Button>
      </form>
      
      <div className="text-center text-sm">
        <Link href="/login" className="flex items-center justify-center gap-2 font-medium text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft size={16} />
          Back to log in
        </Link>
      </div>
    </div>
  );
}
