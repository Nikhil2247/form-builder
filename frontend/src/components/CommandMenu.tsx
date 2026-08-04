'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  FileText,
  Home,
  LayoutDashboard,
  Settings,
  Users,
  Plus,
  BarChart,
  LogOut,
  Palette
} from 'lucide-react';

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  const runCommand = (command: () => void) => {
    setOpen(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => router.push('/forms/builder'))}>
            <Plus className="mr-2 h-4 w-4" />
            <span>Create new form</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/team'))}>
            <Users className="mr-2 h-4 w-4" />
            <span>Invite team member</span>
          </CommandItem>
        </CommandGroup>
        
        <CommandSeparator />
        
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => router.push('/dashboard'))}>
            <Home className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/forms'))}>
            <FileText className="mr-2 h-4 w-4" />
            <span>My Forms</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/analytics'))}>
            <BarChart className="mr-2 h-4 w-4" />
            <span>Analytics</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/admin'))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Admin Panel</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/templates'))}>
            <Palette className="mr-2 h-4 w-4" />
            <span>Templates Gallery</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Settings">
          <CommandItem onSelect={() => runCommand(() => router.push('/settings'))}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Global Settings</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => router.push('/login'))}>
            <LogOut className="mr-2 h-4 w-4" />
            <span>Log out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
