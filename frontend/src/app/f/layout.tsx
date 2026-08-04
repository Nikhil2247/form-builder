import React from 'react';

export default function PublicFormLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted/20 flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-3xl">
        {children}
      </div>
    </div>
  );
}
