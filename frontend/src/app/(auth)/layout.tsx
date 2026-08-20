import React from 'react';

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
          <div className="flex items-center">
            {/* The logo's wordmark is fixed-color (navy/orange), not
                currentColor, so it needs a light plate of its own to stay
                legible against `bg-primary` — the same treatment the icon
                badge this replaces used to get from `bg-primary-foreground`. */}
            <div className="bg-primary-foreground rounded-xl px-4 py-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- next/image's
                  optimizer 400s on local SVGs unless `dangerouslyAllowSVG` is set;
                  not worth loosening for a static decorative logotype. */}
              <img
                src="/logos/impactlens-logo-medium.svg"
                alt="ImpactLens"
                width={300}
                height={72}
                className="h-8 w-auto"
              />
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-4xl font-bold leading-tight">
              Build forms that convert,<br />manage data that scales.
            </h1>
            <p className="text-primary-foreground/80 text-lg max-w-md">
              Join thousands of organizations using ImpactLens to power their data collection and workflows.
            </p>
          </div>
          <div className="text-sm text-primary-foreground/60">
            © {new Date().getFullYear()} ImpactLens. All rights reserved.
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
