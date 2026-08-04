'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Layers } from 'lucide-react';
import { useResetPassword } from '@/hooks/use-auth';
import { toast } from 'sonner';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const resetMutation = useResetPassword();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (!token) {
      toast.error('Invalid or missing reset token');
      return;
    }

    resetMutation.mutate({ token, newPassword: password }, {
      onSuccess: () => {
        toast.success('Password reset successfully. Please log in.');
        router.push('/login');
      },
      onError: (error: any) => {
        toast.error(error.message || 'Failed to reset password');
      }
    });
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="password">New Password</Label>
        <Input 
          id="password" 
          type="password" 
          required 
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={resetMutation.isPending}
        />
        <p className="text-[10px] text-muted-foreground pt-1">Must be at least 8 characters.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm Password</Label>
        <Input 
          id="confirm-password" 
          type="password" 
          required 
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          disabled={resetMutation.isPending}
        />
      </div>
      <Button className="w-full" type="submit" disabled={resetMutation.isPending}>
        {resetMutation.isPending ? 'Resetting...' : 'Reset password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-2 text-center lg:text-left">
        <div className="flex lg:hidden justify-center mb-4 text-primary">
          <div className="bg-primary/10 p-3 rounded-2xl">
            <Layers size={32} />
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Set new password</h1>
        <p className="text-sm text-muted-foreground">
          Your new password must be different from previously used passwords.
        </p>
      </div>
      
      <Suspense fallback={<div>Loading...</div>}>
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
