'use client';
import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Layers, ArrowLeft, ShieldCheck } from 'lucide-react';
import { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator } from '@/components/ui/input-otp';
import { useLoginMfa } from '@/hooks/use-auth';
import { toast } from 'sonner';

function MFAForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mfaToken = searchParams.get('token');
  const [value, setValue] = useState("");
  
  const loginMfaMutation = useLoginMfa();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) {
      toast.error('Missing MFA token. Please log in again.');
      return;
    }
    
    loginMfaMutation.mutate({ mfaToken, code: value }, {
      onSuccess: (data: any) => {
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
      },
      onError: (error: any) => {
        toast.error(error.message || 'Invalid MFA code');
        setValue("");
      }
    });
  };

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="flex justify-center lg:justify-start pt-2">
        <InputOTP maxLength={6} value={value} onChange={setValue} disabled={loginMfaMutation.isPending}>
          <InputOTPGroup>
            <InputOTPSlot index={0} />
            <InputOTPSlot index={1} />
            <InputOTPSlot index={2} />
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            <InputOTPSlot index={3} />
            <InputOTPSlot index={4} />
            <InputOTPSlot index={5} />
          </InputOTPGroup>
        </InputOTP>
      </div>
      <Button className="w-full" type="submit" disabled={value.length !== 6 || loginMfaMutation.isPending}>
        {loginMfaMutation.isPending ? 'Verifying...' : 'Verify and continue'}
      </Button>
    </form>
  );
}

export default function MFAPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col space-y-2 text-center lg:text-left">
        <div className="flex lg:hidden justify-center mb-4 text-primary">
          <div className="bg-primary/10 p-3 rounded-2xl">
            <Layers size={32} />
          </div>
        </div>
        <div className="flex items-center gap-2 justify-center lg:justify-start">
          <ShieldCheck className="text-emerald-500" size={28} />
          <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Enter the 6-digit authentication code from your authenticator app to continue.
        </p>
      </div>
      
      <Suspense fallback={<div>Loading...</div>}>
        <MFAForm />
      </Suspense>
      
      <div className="text-center text-sm">
        <Link href="/login" className="flex items-center justify-center gap-2 font-medium text-muted-foreground hover:text-primary transition-colors">
          <ArrowLeft size={16} />
          Back to log in
        </Link>
      </div>
    </div>
  );
}
