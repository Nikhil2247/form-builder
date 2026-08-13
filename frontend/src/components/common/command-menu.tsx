'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, Plus, UserPlus } from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useCommandMenuStore } from '@/store/command-menu-store';
import { useFilteredNavigation } from '@/hooks/use-filtered-navigation';
import { useUser, useLogout, usePermissions } from '@/hooks/use-auth';

/**
 * ⌘K palette.
 *
 * Rebuilt from the filtered navigation rather than a hand-written list. The
 * previous version had a "/admin" entry pointing at a route that does not exist
 * (a guaranteed 404), showed every destination regardless of role, and its "Log
 * out" item just navigated to /login — the session stayed valid, so the app
 * bounced the user straight back in.
 *
 * It also mounted on public pages: pressing ⌘K on the anonymous form runner
 * opened an app navigation menu. It now renders only for a signed-in user.
 */
export function CommandMenu() {
  const router = useRouter();
  const { isOpen, setOpen, toggle, close } = useCommandMenuStore();
  const { data: session } = useUser();
  const { can } = usePermissions();
  const navigation = useFilteredNavigation();
  const logout = useLogout();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // `key` is typed as a plain string, but it is genuinely absent on some
      // synthetic keydowns — password managers and Chrome's autofill both
      // dispatch them — and an unguarded `.toLowerCase()` there throws out of a
      // document-level listener, which surfaces as an uncaught TypeError on
      // pages that have nothing to do with the command menu.
      if (event.key?.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  if (!session?.user) return null;

  const run = (action: () => void) => {
    close();
    action();
  };

  return (
    <CommandDialog open={isOpen} onOpenChange={setOpen}>
      <CommandInput placeholder="Search for a page or action…" />
      <CommandList>
        <CommandEmpty>Nothing matches.</CommandEmpty>

        {(can('form:create') || can('member:invite')) && (
          <>
            <CommandGroup heading="Actions">
              {can('form:create') && (
                <CommandItem
                  value="create new form build"
                  onSelect={() => run(() => router.push('/forms/builder'))}
                  className="cursor-pointer"
                >
                  <Plus className="mr-2 size-4" />
                  Create a form
                </CommandItem>
              )}
              {can('member:invite') && (
                <CommandItem
                  value="invite team member user"
                  onSelect={() => run(() => router.push('/team'))}
                  className="cursor-pointer"
                >
                  <UserPlus className="mr-2 size-4" />
                  Invite a team member
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {navigation.map((group) => (
          <CommandGroup key={group.title} heading={group.title}>
            {group.items.flatMap((item) => {
              const Icon = item.icon;
              const rows = [
                <CommandItem
                  key={item.href}
                  value={`${group.title} ${item.title}`}
                  onSelect={() => run(() => router.push(item.href))}
                  className="cursor-pointer"
                >
                  <Icon className="mr-2 size-4" strokeWidth={1.5} />
                  {item.title}
                </CommandItem>,
              ];

              for (const child of item.children ?? []) {
                const ChildIcon = child.icon;
                rows.push(
                  <CommandItem
                    key={child.href}
                    value={`${item.title} ${child.title}`}
                    onSelect={() => run(() => router.push(child.href))}
                    className="cursor-pointer"
                  >
                    <ChildIcon className="mr-2 size-4" strokeWidth={1.5} />
                    {item.title} · {child.title}
                  </CommandItem>,
                );
              }

              return rows;
            })}
          </CommandGroup>
        ))}

        <CommandSeparator />

        <CommandGroup heading="Session">
          <CommandItem
            value="log out sign out"
            onSelect={() => run(() => logout.mutate())}
            className="cursor-pointer text-destructive"
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
