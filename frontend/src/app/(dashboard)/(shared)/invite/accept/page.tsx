'use client';

import React from 'react';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
        
        {/* Header graphic */}
        <div className="h-32 bg-primary flex items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
          <div className="w-16 h-16 bg-card rounded-2xl flex items-center justify-center shadow-lg relative z-10">
             <ShieldCheck size={32} className="text-primary" />
          </div>
        </div>

        {/* Content */}
        <div className="p-8 text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">You've been invited!</h1>
          <p className="text-sm text-muted-foreground mb-6">
            <strong className="text-foreground">Alice Cooper</strong> has invited you to join the 
            <strong className="text-foreground"> Acme Corp</strong> team on FormBuilder Enterprise.
          </p>

          <div className="bg-muted border border-border rounded-xl p-4 mb-8 text-left flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Your Role</div>
              <div className="text-sm font-semibold text-foreground">Editor</div>
            </div>
            <div className="text-[10px] text-muted-foreground text-right max-w-[120px]">
              Can create and manage forms, but cannot manage team members.
            </div>
          </div>

          <div className="space-y-3">
            <button className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary text-primary-foreground font-semibold rounded-xl hover:bg-primary/90 transition-all shadow-md hover:shadow-lg">
              Accept Invitation
              <ArrowRight size={18} />
            </button>
            <p className="text-xs text-muted-foreground">
              By accepting, you agree to our Terms of Service and Privacy Policy.
            </p>
          </div>
        </div>
      </div>
      
      <div className="mt-8 text-sm text-muted-foreground flex items-center gap-2">
        Powered by <span className="font-bold text-foreground">FormBuilder</span>
      </div>
    </div>
  );
}
