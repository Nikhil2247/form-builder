'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, LogOut, Menu, User } from 'lucide-react';

import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { useUser, useLogout } from '@/hooks/use-auth';
import { landingRoute } from '@/config/roles';

const NAV_LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/form-templates', label: 'Templates' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
];

/**
 * The marketing site's header.
 *
 * Signed-out visitors see Log in / Get Started. A signed-in visitor browsing
 * the marketing site — someone who followed a link back to impactlens.app, or
 * just has two tabs open — sees the same identity the dashboard shows them
 * (Header.tsx) plus a direct way back in, rather than being offered a second
 * account creation flow for the account they are already signed into.
 *
 * ── The three states, and why the third one exists ────────────────────────
 * Signed in, signed out, and NOT YET KNOWN. That last one is the difference
 * between this feeling considered and feeling broken: the session is resolved
 * asynchronously, so rendering the signed-out buttons while it loads means a
 * signed-in user watches "Log in / Get Started" appear and then swap for their
 * own avatar a moment later. Every page load, on every marketing page. A
 * neutral placeholder of the same size holds the space instead, so the header
 * settles into its answer rather than visibly changing its mind.
 */
export function PublicHeader() {
  const pathname = usePathname();
  const { data: session, isLoading } = useUser();
  const logout = useLogout();
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const user = session?.user;
  const org = session?.activeOrganization;
  const home = landingRoute(user?.systemRole, org?.role);

  const displayName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email
    : '';
  const initials = user
    ? `${user.firstName?.[0] ?? ''}${user.lastName?.[0] ?? ''}`.toUpperCase() ||
      user.email?.[0]?.toUpperCase() ||
      'U'
    : 'U';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center transition-opacity hover:opacity-80">
          {/* The large lockup carries the wordmark and tagline itself, so
              there's no separate text span to keep in sync with it. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image's
              optimizer 400s on local SVGs unless `dangerouslyAllowSVG` is set;
              not worth loosening for a static decorative logotype. */}
          <img
            src="/logos/impactlens-logo-medium.svg"
            alt="ImpactLens"
            width={300}
            height={72}
            className="h-12 w-auto"
          />
        </Link>

        <nav aria-label="Main" className="hidden md:flex md:items-center md:gap-1">
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  // The underline is drawn with a pseudo-element rather than
                  // border-bottom so it sits flush with the header's own edge
                  // and does not shift the label by a pixel when it appears.
                  'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full',
                  'after:bg-primary after:transition-opacity',
                  isActive
                    ? 'text-foreground after:opacity-100'
                    : 'text-muted-foreground after:opacity-0 hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeToggle />

          {isLoading ? (
            // Placeholder of the same footprint as whichever answer arrives, so
            // the row does not reflow when it does.
            <div aria-hidden className="flex items-center gap-2 sm:gap-3">
              <div className="hidden h-8 w-24 animate-pulse rounded-md bg-muted sm:block" />
              <div className="size-9 animate-pulse rounded-full bg-muted" />
            </div>
          ) : user ? (
            <>
              <Link
                href={home}
                className={cn(
                  buttonVariants({ variant: 'default', size: 'sm' }),
                  'hidden gap-1.5 rounded-full sm:inline-flex',
                )}
              >
                <LayoutDashboard className="size-3.5" strokeWidth={2} />
                Dashboard
              </Link>

              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Account menu"
                  className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-muted
                             text-xs font-semibold text-muted-foreground transition-colors
                             hover:bg-accent hover:text-foreground"
                >
                  {user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- an
                    // arbitrary user-supplied URL, which next/image cannot
                    // optimise without every possible host being configured.
                    <img
                      src={user.avatarUrl}
                      alt=""
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    initials
                  )}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>
                    <div className="flex flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{displayName}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground">
                        {user.email}
                      </span>
                      {org && (
                        <span className="mt-1 truncate text-xs font-normal text-muted-foreground">
                          {org.name}
                        </span>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link href={home} />} className="cursor-pointer sm:hidden">
                    <LayoutDashboard className="mr-2 size-3.5" strokeWidth={1.5} /> Dashboard
                  </DropdownMenuItem>
                  <DropdownMenuItem render={<Link href="/profile" />} className="cursor-pointer">
                    <User className="mr-2 size-3.5" strokeWidth={1.5} /> Profile and security
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => logout.mutate()}
                    disabled={logout.isPending}
                    className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                  >
                    <LogOut className="mr-2 size-3.5" strokeWidth={1.5} />
                    {logout.isPending ? 'Signing out…' : 'Sign out'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'rounded-full')}
              >
                Get Started
              </Link>
            </>
          )}

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className="flex size-9 items-center justify-center rounded-md text-foreground hover:bg-muted md:hidden"
            >
              <Menu className="size-5" strokeWidth={1.75} />
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="px-4 pt-4">Menu</SheetTitle>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-2 py-2">
                {NAV_LINKS.map((link) => (
                  <SheetClose
                    key={link.href}
                    render={<Link href={link.href} />}
                    className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    {link.label}
                  </SheetClose>
                ))}
              </nav>

              <div className="mt-auto flex flex-col gap-2 border-t border-border p-4">
                {isLoading ? (
                  <div aria-hidden className="h-9 animate-pulse rounded-md bg-muted" />
                ) : user ? (
                  <>
                    <SheetClose
                      render={<Link href={home} />}
                      className={buttonVariants({
                        variant: 'default',
                        size: 'sm',
                        className: 'gap-1.5 rounded-full',
                      })}
                    >
                      <LayoutDashboard className="size-3.5" strokeWidth={2} />
                      Dashboard
                    </SheetClose>
                    <SheetClose
                      render={<Link href="/profile" />}
                      className={buttonVariants({ variant: 'outline', size: 'sm', className: 'rounded-full' })}
                    >
                      Profile and security
                    </SheetClose>
                  </>
                ) : (
                  <>
                    <SheetClose
                      render={<Link href="/signup" />}
                      className={buttonVariants({ variant: 'default', size: 'sm', className: 'rounded-full' })}
                    >
                      Get Started
                    </SheetClose>
                    <SheetClose
                      render={<Link href="/login" />}
                      className={buttonVariants({ variant: 'outline', size: 'sm', className: 'rounded-full' })}
                    >
                      Log in
                    </SheetClose>
                  </>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
