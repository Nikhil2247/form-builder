'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Layers } from 'lucide-react';
import { useRegister } from '@/hooks/use-auth';
import { toast } from 'sonner';

export default function SignupPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const registerMutation = useRegister();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate(
      { firstName, lastName, email, password },
      {
        onSuccess: () => {
          toast.success('Account created successfully!');
          router.push('/dashboard');
        },
        onError: (error: any) => {
          toast.error(error.message || 'Failed to create account.');
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
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-sm text-muted-foreground">
          Enter your details below to get started
        </p>
      </div>
      
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="first-name">First name</Label>
            <Input 
              id="first-name" 
              placeholder="John" 
              required 
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={registerMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="last-name">Last name</Label>
            <Input 
              id="last-name" 
              placeholder="Doe" 
              required 
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={registerMutation.isPending}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Work Email</Label>
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
            disabled={registerMutation.isPending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input 
            id="password" 
            type="password" 
            required 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={registerMutation.isPending}
          />
        </div>
        <Button className="w-full" type="submit" disabled={registerMutation.isPending}>
          {registerMutation.isPending ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
      
      <div className="text-center text-sm text-muted-foreground">
        By clicking continue, you agree to our{' '}
        <Link href="/terms" className="underline underline-offset-4 hover:text-primary">
          Terms of Service
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline underline-offset-4 hover:text-primary">
          Privacy Policy
        </Link>.
      </div>

      <div className="text-center text-sm">
        Already have an account?{' '}
        <Link href="/login" className="underline underline-offset-4 hover:text-primary font-medium">
          Sign in
        </Link>
      </div>
    </div>
  );
}
