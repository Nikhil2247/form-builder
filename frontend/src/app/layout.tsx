import type { Metadata } from 'next';
import { Inter, Geist } from 'next/font/google';
import './globals.css';

import { Toaster } from 'sonner';
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'FormBuilder - Enterprise Dynamic Form Suite',
  description: 'General-purpose enterprise form builder with drag-and-drop canvas, conditional logic, and modern design.',
};

import { CommandMenu } from '@/components/CommandMenu';

import { ThemeProvider } from '@/components/theme-provider';

import { QueryProvider } from '@/providers/query-provider';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            {children}
            <CommandMenu />
            <Toaster position="top-right" richColors closeButton />
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
