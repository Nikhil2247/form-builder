'use client';

import React, { useEffect, useState } from 'react';
import {
  Check,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Shield,
  ShieldCheck,
  Smartphone,
  User,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  PageHeader,
  PageShell,
  StatusBadge,
  Modal,
  ModalActions,
  CopyField,
} from '@/components/shared';
import {
  useUser,
  useSetupMfa,
  useVerifyMfa,
  useDisableMfa,
  useChangePassword,
} from '@/hooks/use-auth';
import { fetchApi } from '@/lib/api';
import { toastError } from '@/lib/errors';
import { useQueryClient } from '@tanstack/react-query';

export default function ProfilePage() {
  const { data: session, isLoading } = useUser();
  const queryClient = useQueryClient();
  const user = session?.user;

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Your account"
        description="Personal details, password, and two-factor authentication."
        badge={user && <StatusBadge status={user.systemRole} />}
        isLoading={isLoading}
      />

      <Tabs defaultValue="profile" className="space-y-5">
        <TabsList>
          <TabsTrigger value="profile" className="gap-1.5">
            <User className="size-3.5" /> Profile
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5">
            <Shield className="size-3.5" /> Security
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileDetails
            isLoading={isLoading}
            firstName={user?.firstName ?? ''}
            lastName={user?.lastName ?? ''}
            email={user?.email ?? ''}
            emailVerified={user?.emailVerified}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ['user'] })}
          />
        </TabsContent>

        <TabsContent value="security" className="space-y-5">
          <PasswordCard />
          <MfaCard enabled={!!user?.mfaEnabled} />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SettingsCard({
  title,
  description,
  icon: Icon,
  children,
  footer,
}: {
  title: string;
  description?: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {Icon && <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />}
          {title}
        </h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4 px-5 py-5">{children}</div>
      {footer && (
        <div className="flex justify-end border-t border-border bg-muted/30 px-5 py-3">
          {footer}
        </div>
      )}
    </Card>
  );
}

function ProfileDetails({
  isLoading,
  firstName: initialFirst,
  lastName: initialLast,
  email,
  emailVerified,
  onSaved,
}: {
  isLoading: boolean;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified?: boolean;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState(initialFirst);
  const [lastName, setLastName] = useState(initialLast);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setFirstName(initialFirst);
    setLastName(initialLast);
  }, [initialFirst, initialLast]);

  const dirty = firstName !== initialFirst || lastName !== initialLast;

  async function save() {
    setIsSaving(true);
    try {
      await fetchApi('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      toast.success('Profile updated');
      onSaved();
    } catch (error) {
      // The catch is what stops a failed save flipping the button to a green
      // "Saved Successfully!" regardless of outcome. This one still reports for
      // itself: it calls `fetchApi` directly rather than through a mutation, so
      // the global MutationCache handler never sees it.
      toastError(error, 'Could not save your profile');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <SettingsCard
      title="Profile details"
      description="This name appears on forms you create and in your organization's member list."
      icon={User}
      footer={
        <Button size="sm" onClick={save} disabled={!dirty || isSaving} className="gap-2">
          {isSaving && <Loader2 className="size-3.5 animate-spin" />}
          Save changes
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="first-name">First name</Label>
          {isLoading ? (
            <Skeleton className="h-9" />
          ) : (
            <Input
              id="first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
            />
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="last-name">Last name</Label>
          {isLoading ? (
            <Skeleton className="h-9" />
          ) : (
            <Input
              id="last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
            />
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="email">Email address</Label>
        <div className="relative">
          <Mail
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input id="email" value={email} readOnly disabled className="pl-9" />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {emailVerified ? (
            <>
              <Check className="size-3 text-success" /> Verified
            </>
          ) : (
            'Not yet verified — check your inbox for the verification link.'
          )}
          {' · '}Changing your email requires support verification.
        </p>
      </div>
    </SettingsCard>
  );
}

function PasswordCard() {
  const changePassword = useChangePassword();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= 8 && !mismatch;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    try {
      await changePassword.mutateAsync({ currentPassword: current, newPassword: next });
      toast.success('Password changed');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch {
      // Reported globally; the typed values stay so the user can correct one.
    }
  }

  return (
    <form onSubmit={submit}>
      <SettingsCard
        title="Password"
        description="Use at least 8 characters. A long passphrase beats a short complex one."
        icon={Lock}
        footer={
          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit || changePassword.isPending}
            className="gap-2"
          >
            {changePassword.isPending && <Loader2 className="size-3.5 animate-spin" />}
            Update password
          </Button>
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={8}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch}
              aria-describedby={mismatch ? 'confirm-error' : undefined}
            />
            {mismatch && (
              <p id="confirm-error" className="text-xs text-destructive">
                Passwords do not match.
              </p>
            )}
          </div>
        </div>
      </SettingsCard>
    </form>
  );
}

function MfaCard({ enabled }: { enabled: boolean }) {
  const setupMfa = useSetupMfa();
  const verifyMfa = useVerifyMfa();
  const disableMfa = useDisableMfa();

  const [step, setStep] = useState<'idle' | 'enrol'>('idle');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');

  async function beginEnrolment() {
    try {
      const res = await setupMfa.mutateAsync();
      // The API returns `qrCodeUrl`; the old code read `res.qrCode` and
      // `res.data.qrCode`, neither of which exists, so the <img> src was always
      // null and the QR step rendered blank.
      setQrUrl(res.qrCodeUrl ?? null);
      setSecret(res.secret ?? null);
      setStep('enrol');
    } catch {
      // Reported globally; the panel stays on its idle step.
    }
  }

  async function confirmEnrolment() {
    try {
      const res = await verifyMfa.mutateAsync(code);
      setStep('idle');
      setQrUrl(null);
      setCode('');
      // Recovery codes are shown exactly once. Losing them and the phone means
      // account recovery through support.
      if (res.recoveryCodes?.length) setRecoveryCodes(res.recoveryCodes);
      toast.success('Two-factor authentication is on');
    } catch {
      // Reported globally; the QR step stays up so the code can be retyped.
    }
  }

  async function confirmDisable() {
    try {
      await disableMfa.mutateAsync({ currentPassword: disablePassword });
      setDisableOpen(false);
      setDisablePassword('');
      toast.success('Two-factor authentication is off');
    } catch {
      // Reported globally; the dialog stays open with the password field intact.
    }
  }

  return (
    <>
      <SettingsCard
        title="Two-factor authentication"
        description="Require a code from your authenticator app in addition to your password."
        icon={Smartphone}
      >
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-center gap-3">
            <span
              className={`flex size-9 items-center justify-center rounded-full ${
                enabled ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
              }`}
            >
              <ShieldCheck className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">
                {enabled ? 'Enabled' : 'Not enabled'}
              </p>
              <p className="text-xs text-muted-foreground">
                {enabled
                  ? 'You will be asked for a code when you sign in.'
                  : 'Your account is protected by a password only.'}
              </p>
            </div>
          </div>

          {step === 'idle' &&
            (enabled ? (
              <Button variant="destructive" size="sm" onClick={() => setDisableOpen(true)}>
                Turn off
              </Button>
            ) : (
              <Button size="sm" onClick={beginEnrolment} disabled={setupMfa.isPending} className="gap-2">
                {setupMfa.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Turn on
              </Button>
            ))}
        </div>

        {step === 'enrol' && (
          <div className="space-y-5 rounded-lg border border-border p-5">
            <div>
              <h3 className="text-sm font-semibold">1. Scan this code</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Open Google Authenticator, 1Password, or Authy and scan.
              </p>
            </div>

            {qrUrl ? (
              <div className="flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrUrl}
                  alt="Two-factor authentication QR code"
                  className="size-44 rounded-lg border border-border bg-white p-2"
                />
              </div>
            ) : (
              <Skeleton className="mx-auto size-44" />
            )}

            {secret && (
              <CopyField
                label="Or enter this key manually"
                value={secret}
                masked
                description="Treat this like a password."
              />
            )}

            <div className="space-y-2">
              <Label htmlFor="mfa-code">2. Enter the 6-digit code</Label>
              <div className="relative">
                <KeyRound
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id="mfa-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="tabular pl-9 text-center tracking-[0.3em]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStep('idle');
                  setCode('');
                  setQrUrl(null);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmEnrolment}
                disabled={code.length !== 6 || verifyMfa.isPending}
                className="gap-2"
              >
                {verifyMfa.isPending && <Loader2 className="size-3.5 animate-spin" />}
                Verify and enable
              </Button>
            </div>
          </div>
        )}
      </SettingsCard>

      {/* Recovery codes — shown once, immediately after enrolment. */}
      <Modal
        open={!!recoveryCodes}
        onOpenChange={(open) => !open && setRecoveryCodes(null)}
        title="Save your recovery codes"
        description="Each code works once. Store them somewhere safe — they are the only way back in if you lose your device."
        footer={
          <Button size="sm" onClick={() => setRecoveryCodes(null)}>
            I have saved them
          </Button>
        }
      >
        <div className="tabular grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/40 p-4 font-mono text-sm">
          {recoveryCodes?.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      </Modal>

      {/* Disabling requires the password — the API rejects the request without
          it, which is why the old one-click button always failed. */}
      <Modal
        open={disableOpen}
        onOpenChange={(open) => {
          setDisableOpen(open);
          if (!open) setDisablePassword('');
        }}
        size="sm"
        title="Turn off two-factor authentication"
        description="Confirm with your account password. This makes your account password-only."
        footer={
          <ModalActions
            onCancel={() => setDisableOpen(false)}
            confirmLabel="Turn off 2FA"
            variant="destructive"
            onConfirm={confirmDisable}
            isPending={disableMfa.isPending}
            disabled={disablePassword.length === 0}
          />
        }
      >
        <div className="space-y-1.5">
          <Label htmlFor="disable-password">Account password</Label>
          <Input
            id="disable-password"
            type="password"
            value={disablePassword}
            onChange={(e) => setDisablePassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
      </Modal>
    </>
  );
}
