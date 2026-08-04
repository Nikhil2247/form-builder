'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Layers } from 'lucide-react';
import { useLogin } from '@/hooks/use-auth';
import { toast } from 'sonner';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const loginMutation = useLogin();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(
      { email, password },
      {
        onSuccess: (data: any) => {
          if (data.mfaRequired) {
            router.push(`/mfa?token=${data.mfaToken}`);
          } else {
            toast.success('Logged in successfully!');
            const user = data.user;
            if (user?.systemRole === 'SUPER_ADMIN') {
              router.push('/platform');
            } else if (user?.orgRole === 'ADMIN') {
              router.push('/org-audit');
            } else if (user?.orgRole === 'EDITOR') {
              router.push('/forms/builder');
            } else {
              router.push('/dashboard');
            }
          }
        },
        onError: (error: any) => {
          toast.error(error.message || 'Failed to log in. Please check your credentials.');
        }
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-2 text-center lg:text-left">
        <div className="flex lg:hidden justify-center mb-4 text-primary">
          <div className="bg-primary/10 p-3 rounded-2xl">
            <Layers size={32} />
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email to sign in to your account
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
            disabled={loginMutation.isPending}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link 
              href="/forgot-password" 
              className="text-sm font-medium text-primary hover:underline underline-offset-4"
            >
              Forgot password?
            </Link>
          </div>
          <Input 
            id="password" 
            type="password" 
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loginMutation.isPending}
          />
        </div>
        <Button className="w-full" type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Signing In...' : 'Sign In'}
        </Button>
      </form>
      
      <div className="text-center text-sm">
        Don't have an account?{' '}
        <Link href="/signup" className="underline underline-offset-4 hover:text-primary font-medium">
          Sign up
        </Link>
      </div>
    </div>
  );
}
