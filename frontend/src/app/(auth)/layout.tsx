import React from 'react';
import Link from 'next/link';
import { Layers } from 'lucide-react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen overflow-hidden bg-muted/30">
      <div className="h-full w-full lg:grid lg:grid-cols-2">
        {/* Left Side - Brand / Visual */}
        <div className="hidden h-full overflow-y-auto bg-primary lg:flex flex-col justify-between p-12 text-primary-foreground">
          <div className="flex items-center gap-2 text-xl font-bold">
            <div className="bg-primary-foreground text-primary p-2 rounded-xl">
              <Layers size={24} strokeWidth={2.5} />
            </div>
            FormFlow Enterprise
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-bold leading-tight">
              Build forms that convert,<br />manage data that scales.
            </h1>
            <p className="text-primary-foreground/80 text-lg max-w-md">
              Join thousands of organizations using FormFlow to power their data collection and workflows.
            </p>
          </div>
          <div className="text-sm text-primary-foreground/60">
            © {new Date().getFullYear()} FormFlow Enterprise. All rights reserved.
          </div>
        </div>

        {/* Right Side - Auth Forms */}
        <div className="flex h-full items-center justify-center overflow-y-auto p-8 sm:p-12">
          <div className="w-full max-w-[400px]">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
