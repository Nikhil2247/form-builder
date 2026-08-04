'use client';

import React, { useState, useEffect } from 'react';
import { User, Mail, Shield, Save, Loader2, CheckCircle2, Smartphone, ShieldCheck, KeyRound, ArrowRight, Zap, Bell, Monitor, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUser, useSetupMfa, useVerifyMfa, useDisableMfa } from '@/hooks/use-auth';
import { fetchApi } from '@/lib/api';

export default function ProfilePage() {
  const { data: session, isLoading } = useUser();
  const setupMfa = useSetupMfa();
  const verifyMfa = useVerifyMfa();
  const disableMfa = useDisableMfa();

  const user = session?.user;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [saved, setSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [mfaCode, setMfaCode] = useState('');
  const [mfaQr, setMfaQr] = useState<string | null>(null);
  const [mfaSetupStep, setMfaSetupStep] = useState<'idle' | 'setup' | 'verify'>('idle');

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName ?? '');
      setLastName(user.lastName ?? '');
      setEmail(user.email ?? '');
    }
  }, [user]);

  async function handleSaveProfile() {
    setIsSaving(true);
    try {
      await fetchApi('/auth/me', { method: 'PATCH', body: JSON.stringify({ firstName, lastName }) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSetupMfa() {
    const res = await setupMfa.mutateAsync();
    setMfaQr(res?.qrCode ?? res?.data?.qrCode ?? null);
    setMfaSetupStep('setup');
  }

  async function handleVerifyMfa() {
    await verifyMfa.mutateAsync(mfaCode);
    setMfaSetupStep('idle');
    setMfaQr(null);
    setMfaCode('');
  }

  const hasMfa = (user as any)?.mfaEnabled;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-6 duration-700 pb-12">
      {/* Premium Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-primary/10 via-primary/5 to-background border border-border p-8 sm:p-12 shadow-sm">
        <div className="absolute top-0 right-0 -mt-16 -mr-16 w-64 h-64 bg-primary/20 rounded-full blur-[80px]" />
        <div className="absolute bottom-0 left-0 -mb-16 -ml-16 w-64 h-64 bg-blue-500/20 rounded-full blur-[80px]" />
        
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-6 sm:gap-8">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-primary to-blue-500 rounded-full blur-md opacity-60 animate-pulse" />
            <div className="relative flex h-24 w-24 sm:h-32 sm:w-32 items-center justify-center rounded-full bg-card border-4 border-background text-primary-foreground text-4xl sm:text-5xl font-black shadow-2xl overflow-hidden group">
              <div className="absolute inset-0 bg-gradient-to-br from-primary to-blue-600 opacity-90 group-hover:opacity-100 transition-opacity" />
              <span className="relative z-10 text-white drop-shadow-md">
                {isLoading ? '?' : `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || 'U'}
              </span>
            </div>
          </div>
          
          <div className="space-y-2 flex-1">
            {isLoading ? (
              <Skeleton className="h-8 w-48 mb-2 bg-background/50" />
            ) : (
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">
                {firstName} {lastName}
              </h1>
            )}
            
            {isLoading ? (
              <Skeleton className="h-4 w-64 bg-background/50" />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center text-sm font-medium text-muted-foreground bg-background/50 backdrop-blur-sm px-3 py-1 rounded-full border border-border/50">
                  <Mail size={14} className="mr-2 text-primary" /> {email}
                </span>
                <span className="flex items-center text-[11px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
                  <ShieldCheck size={14} className="mr-1.5" /> {user?.systemRole ?? 'USER'}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <div className="flex justify-center sm:justify-start">
          <TabsList className="bg-muted/40 p-1.5 rounded-2xl inline-flex h-auto shadow-sm border border-border/50 backdrop-blur-md">
            <TabsTrigger value="profile" className="rounded-xl px-6 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all duration-300">
              <User size={16} className="mr-2" /> Personal Info
            </TabsTrigger>
            <TabsTrigger value="security" className="rounded-xl px-6 py-2.5 data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary transition-all duration-300">
              <Shield size={16} className="mr-2" /> Security
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Profile Tab */}
        <TabsContent value="profile" className="animate-in fade-in zoom-in-95 duration-500 outline-none">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 rounded-2xl border border-border/60 p-0 overflow-hidden bg-card/50 backdrop-blur-sm shadow-sm transition-all hover:shadow-md">
              <div className="p-6 sm:p-8 border-b border-border/50 bg-muted/20">
                <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <User size={18} className="text-primary" /> Profile Details
                </h3>
                <p className="text-sm text-muted-foreground mt-1">Update your personal information and how we can reach you.</p>
              </div>
              
              <div className="p-6 sm:p-8 space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground/90">First Name</label>
                    {isLoading ? <Skeleton className="h-11 rounded-xl" /> : (
                      <Input 
                        value={firstName} 
                        onChange={(e) => setFirstName(e.target.value)} 
                        className="h-11 rounded-xl bg-background border-border/60 focus-visible:ring-primary/20 focus-visible:border-primary transition-all shadow-sm" 
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground/90">Last Name</label>
                    {isLoading ? <Skeleton className="h-11 rounded-xl" /> : (
                      <Input 
                        value={lastName} 
                        onChange={(e) => setLastName(e.target.value)} 
                        className="h-11 rounded-xl bg-background border-border/60 focus-visible:ring-primary/20 focus-visible:border-primary transition-all shadow-sm" 
                      />
                    )}
                  </div>
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground/90 flex items-center gap-2">
                    Email Address
                  </label>
                  {isLoading ? <Skeleton className="h-11 rounded-xl" /> : (
                    <div className="relative">
                      <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input 
                        value={email} 
                        readOnly 
                        className="h-11 rounded-xl pl-10 bg-muted/30 border-border/40 text-muted-foreground cursor-not-allowed shadow-inner" 
                      />
                    </div>
                  )}
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mt-2 bg-muted/40 p-2.5 rounded-lg border border-border/50 inline-flex">
                    <Zap size={14} className="text-amber-500" /> Email changes require support verification for security.
                  </p>
                </div>
              </div>

              <div className="p-6 border-t border-border/50 bg-muted/10 flex justify-end">
                <Button 
                  onClick={handleSaveProfile} 
                  disabled={isSaving || isLoading} 
                  className={`h-11 px-8 rounded-xl gap-2 font-semibold transition-all duration-300 ${saved ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20' : 'shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5'}`}
                >
                  {isSaving ? <><Loader2 size={16} className="animate-spin" />Saving...</> : saved ? <><CheckCircle2 size={16} />Saved Successfully!</> : <><Save size={16} />Save Changes</>}
                </Button>
              </div>
            </Card>

            <div className="space-y-6">
              <Card className="rounded-2xl border border-border/60 p-6 bg-card/50 backdrop-blur-sm shadow-sm">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center mb-4">
                  <Bell size={20} className="text-blue-500" />
                </div>
                <h4 className="font-bold text-foreground mb-2">Notifications</h4>
                <p className="text-sm text-muted-foreground mb-4">Manage how you receive updates and alerts.</p>
                <Button variant="outline" className="w-full rounded-xl gap-2 h-10">Manage Preferences <ArrowRight size={14} /></Button>
              </Card>

              <Card className="rounded-2xl border border-border/60 p-6 bg-card/50 backdrop-blur-sm shadow-sm">
                <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center mb-4">
                  <Monitor size={20} className="text-purple-500" />
                </div>
                <h4 className="font-bold text-foreground mb-2">Active Sessions</h4>
                <p className="text-sm text-muted-foreground mb-4">You are currently signed in on this device.</p>
                <Button variant="ghost" className="w-full rounded-xl gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive h-10">
                  <LogOut size={14} /> Sign out all other devices
                </Button>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security" className="animate-in fade-in zoom-in-95 duration-500 outline-none">
          <Card className="max-w-3xl rounded-2xl border border-border/60 p-0 overflow-hidden bg-card/50 backdrop-blur-sm shadow-sm">
            <div className="p-6 sm:p-8 border-b border-border/50 bg-muted/20">
              <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Shield size={18} className="text-primary" /> Security Settings
              </h3>
              <p className="text-sm text-muted-foreground mt-1">Protect your account with advanced security features.</p>
            </div>
            
            <div className="p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 p-6 rounded-2xl border border-border/50 bg-background shadow-sm hover:shadow-md transition-all">
                <div className="flex gap-4">
                  <div className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-inner ${hasMfa ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                    <Smartphone size={24} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                      Two-Factor Authentication (2FA)
                      {hasMfa && <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] uppercase">Active</Badge>}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1.5 max-w-md leading-relaxed">
                      Add an extra layer of security to your account. We'll ask for a code from your authenticator app when you sign in.
                    </p>
                  </div>
                </div>

                <div className="shrink-0">
                  {mfaSetupStep === 'idle' && (
                    hasMfa ? (
                      <Button variant="outline" className="rounded-xl h-11 px-6 border-destructive/20 text-destructive hover:bg-destructive/10 transition-colors" onClick={() => disableMfa.mutate()} disabled={disableMfa.isPending}>
                        {disableMfa.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <Shield size={16} className="mr-2" />}
                        {disableMfa.isPending ? 'Disabling...' : 'Disable 2FA'}
                      </Button>
                    ) : (
                      <Button className="rounded-xl h-11 px-6 shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5 transition-all" onClick={handleSetupMfa} disabled={setupMfa.isPending}>
                        {setupMfa.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <ShieldCheck size={16} className="mr-2" />}
                        {setupMfa.isPending ? 'Setting up...' : 'Enable 2FA'}
                      </Button>
                    )
                  )}
                </div>
              </div>

              {mfaSetupStep === 'setup' && mfaQr && (
                <div className="mt-6 p-8 rounded-2xl border border-primary/20 bg-primary/5 animate-in slide-in-from-top-4 fade-in duration-500 text-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                    <ShieldCheck size={120} />
                  </div>
                  <h4 className="text-lg font-bold text-foreground mb-2">Scan QR Code</h4>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
                    Open your authenticator app (like Google Authenticator or Authy) and scan this code to link your device.
                  </p>
                  <div className="inline-block p-4 rounded-2xl bg-white border border-border shadow-lg mb-6">
                    <img src={mfaQr} alt="MFA QR Code" className="w-48 h-48" />
                  </div>
                  <div className="max-w-xs mx-auto space-y-4">
                    <div className="relative">
                      <KeyRound size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input 
                        placeholder="000 000" 
                        value={mfaCode} 
                        onChange={(e) => setMfaCode(e.target.value.replace(/[^0-9]/g, ''))} 
                        maxLength={6} 
                        className="h-12 rounded-xl pl-12 font-mono text-center text-xl tracking-[0.25em] bg-background border-border/60 focus-visible:ring-primary/20" 
                      />
                    </div>
                    <Button 
                      className="w-full h-11 rounded-xl text-base font-semibold shadow-primary/20 hover:shadow-primary/30" 
                      onClick={handleVerifyMfa} 
                      disabled={mfaCode.length !== 6 || verifyMfa.isPending}
                    >
                      {verifyMfa.isPending ? <><Loader2 size={18} className="animate-spin mr-2" />Verifying...</> : 'Verify & Enable'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
