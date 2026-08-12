'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Building2, Check, Loader2, ShieldCheck } from 'lucide-react';

import { fetchApi, unwrap } from '@/lib/api';
import { useUser } from '@/hooks/use-auth';

/**
 * Invitation acceptance.
 *
 * Lives outside the (dashboard) route group on purpose: the recipient is very
 * often signed out — and may have no account at all — so wrapping this in the
 * dashboard sidebar/header chrome would frame a signed-out page as an app page.
 */

interface InvitationPreview {
  email: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER';
  organizationName: string;
  organizationLogoUrl: string | null;
  invitedByName: string | null;
  expiresAt: string;
  isAcceptable: boolean;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
}

/** Mirrors the OrgRole comments in schema.prisma — keep the two in step. */
const ROLE_SUMMARY: Record<InvitationPreview['role'], string> = {
  ADMIN: 'Full control: manage forms, members, and organization settings.',
  EDITOR: 'Create and edit forms and view submissions. Cannot manage members.',
  VIEWER: 'Read-only access to forms and submissions.',
};

const STATUS_MESSAGE: Record<string, string> = {
  ACCEPTED: 'This invitation has already been used.',
  EXPIRED: 'This invitation has expired. Ask an admin to send a new one.',
  REVOKED: 'This invitation was revoked.',
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        {children}
      </div>
      <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
        Powered by <span className="font-bold text-foreground">FormBuilder</span>
      </p>
    </div>
  );
}

/** Centred icon + message, used by every terminal state. */
function Notice({
  icon,
  title,
  children,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  tone?: 'neutral' | 'error' | 'success';
}) {
  const toneClass =
    tone === 'error'
      ? 'bg-destructive/10 text-destructive'
      : tone === 'success'
        ? 'bg-primary/10 text-primary'
        : 'bg-muted text-muted-foreground';

  return (
    <div className="p-8 text-center">
      <div
        className={`mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl ${toneClass}`}
      >
        {icon}
      </div>
      <h1 className="mb-2 text-xl font-bold text-foreground">{title}</h1>
      {children}
    </div>
  );
}

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();

  const token = searchParams.get('token');
  const { data: session, isLoading: sessionLoading } = useUser();

  const preview = useQuery<InvitationPreview>({
    queryKey: ['invitation', token],
    // The invitee may not have an account yet — never attach a bearer token.
    queryFn: async () =>
      unwrap<InvitationPreview>(
        await fetchApi(`/organizations/invitations/${token}`, { anonymous: true }),
      ),
    enabled: !!token,
    retry: false,
  });

  const accept = useMutation({
    // Previously this mutation had no error path at all: an expired or already
    // used invitation left the button spinning back to idle and said nothing.
    meta: { errorFallback: 'Could not accept this invitation' },
    mutationFn: async () =>
      unwrap<{ organization: { id: string; name: string }; role: string }>(
        await fetchApi(`/organizations/invitations/${token}/accept`, { method: 'POST' }),
      ),
    onSuccess: async () => {
      // The API already made this the active workspace. Drop every cached
      // query so the app reloads as the new org rather than the previous one.
      await queryClient.invalidateQueries();
      router.push('/dashboard');
    },
  });

  // ── Missing or malformed link ─────────────────────────────────────────────
  if (!token) {
    return (
      <Notice
        icon={<AlertCircle className="size-7" strokeWidth={1.5} />}
        title="Invalid invitation link"
        tone="error"
      >
        <p className="text-sm text-muted-foreground">
          This link is missing its invitation token. Check the link in your email, or ask an
          admin to send a new invitation.
        </p>
      </Notice>
    );
  }

  if (preview.isLoading || sessionLoading) {
    return (
      <Notice
        icon={<Loader2 className="size-7 animate-spin" strokeWidth={1.5} />}
        title="Checking your invitation"
      />
    );
  }

  if (preview.isError || !preview.data) {
    return (
      <Notice
        icon={<AlertCircle className="size-7" strokeWidth={1.5} />}
        title="Invitation not found"
        tone="error"
      >
        <p className="text-sm text-muted-foreground">
          This invitation link is not valid. It may have been revoked, or already used.
        </p>
      </Notice>
    );
  }

  const invitation = preview.data;

  // ── Valid link, but no longer usable ──────────────────────────────────────
  if (!invitation.isAcceptable) {
    return (
      <Notice
        icon={<AlertCircle className="size-7" strokeWidth={1.5} />}
        title="This invitation can't be used"
        tone="error"
      >
        <p className="text-sm text-muted-foreground">
          {STATUS_MESSAGE[invitation.status] ??
            'This invitation is no longer active. Ask an admin to send a new one.'}
        </p>
      </Notice>
    );
  }

  const isSignedIn = !!session?.user;
  // Round-trip back here after authenticating, token intact.
  const returnTo = encodeURIComponent(`/invite/accept?token=${token}`);

  return (
    <>
      <div className="flex h-28 items-center justify-center bg-primary">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-card shadow-lg">
          <ShieldCheck size={32} className="text-primary" />
        </div>
      </div>

      <div className="p-8 text-center">
        <h1 className="mb-2 text-2xl font-bold text-foreground">You&rsquo;ve been invited</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {invitation.invitedByName ? (
            <>
              <strong className="text-foreground">{invitation.invitedByName}</strong> has invited
              you to join{' '}
            </>
          ) : (
            <>You&rsquo;ve been invited to join </>
          )}
          <strong className="text-foreground">{invitation.organizationName}</strong> on
          FormBuilder.
        </p>

        <div className="mb-6 flex items-center justify-between gap-4 rounded-xl border border-border bg-muted p-4 text-left">
          <div className="min-w-0">
            <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Your role
            </div>
            <div className="text-sm font-semibold capitalize text-foreground">
              {invitation.role.toLowerCase()}
            </div>
          </div>
          <p className="max-w-[150px] text-right text-[10px] leading-snug text-muted-foreground">
            {ROLE_SUMMARY[invitation.role]}
          </p>
        </div>

        {accept.isError && (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {accept.error instanceof Error
              ? accept.error.message
              : 'Could not accept the invitation. Try again.'}
          </p>
        )}

        {isSignedIn ? (
          <>
            {/* The invite is addressed to a specific mailbox. Signing in as
                someone else is a common and confusing mistake, so name the
                account being joined rather than silently binding the wrong one. */}
            {session.user.email?.toLowerCase() !== invitation.email.toLowerCase() && (
              <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
                This invitation was sent to{' '}
                <strong className="text-foreground">{invitation.email}</strong>, but you&rsquo;re
                signed in as <strong className="text-foreground">{session.user.email}</strong>.
                Accepting will add <em>this</em> account.
              </p>
            )}

            <button
              onClick={() => accept.mutate()}
              disabled={accept.isPending || accept.isSuccess}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3
                         font-semibold text-primary-foreground shadow-md transition-all
                         hover:bg-primary/90 hover:shadow-lg
                         disabled:cursor-not-allowed disabled:opacity-60"
            >
              {accept.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} /> Joining&hellip;
                </>
              ) : accept.isSuccess ? (
                <>
                  <Check className="size-4" strokeWidth={2} /> Joined
                </>
              ) : (
                <>
                  Accept invitation
                  <ArrowRight size={18} />
                </>
              )}
            </button>
            <p className="mt-3 text-xs text-muted-foreground">
              By accepting, you agree to our Terms of Service and Privacy Policy.
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <Link
              href={`/login?next=${returnTo}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3
                         font-semibold text-primary-foreground shadow-md transition-all
                         hover:bg-primary/90 hover:shadow-lg"
            >
              Sign in to accept
              <ArrowRight size={18} />
            </Link>
            <Link
              href={`/signup?next=${returnTo}`}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-border
                         px-4 py-3 font-semibold text-foreground transition-colors hover:bg-muted"
            >
              <Building2 className="size-4" strokeWidth={1.5} />
              Create an account
            </Link>
            <p className="text-xs text-muted-foreground">
              Use <strong className="text-foreground">{invitation.email}</strong> so the
              invitation matches your account.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/**
 * useSearchParams() opts this subtree into client rendering, which Next
 * requires an explicit Suspense boundary around.
 */
export default function AcceptInvitePage() {
  return (
    <Shell>
      <Suspense
        fallback={
          <Notice
            icon={<Loader2 className="size-7 animate-spin" strokeWidth={1.5} />}
            title="Loading invitation"
          />
        }
      >
        <AcceptInviteContent />
      </Suspense>
    </Shell>
  );
}
