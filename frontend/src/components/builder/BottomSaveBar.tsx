'use client';

import React from 'react';
import { RefreshCw, Check } from 'lucide-react';

interface BottomSaveBarProps {
  hasUnsavedChanges: boolean;
  onSaveChanges: () => void;
}

export function BottomSaveBar({ hasUnsavedChanges, onSaveChanges }: BottomSaveBarProps) {
  return (
    <footer className="sticky bottom-0 z-40 w-full bg-white border-t border-slate-200/90 px-6 py-3 flex items-center justify-between shadow-md font-sans">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <RefreshCw size={14} className="text-amber-500 animate-spin-slow" />
        <span>{hasUnsavedChanges ? 'Unsaved changes' : 'All changes saved'}</span>
      </div>

      <button
        onClick={onSaveChanges}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0e7490] hover:bg-[#155e75] text-white font-bold text-xs rounded-xl shadow-sm transition-all cursor-pointer hover:shadow-cyan-600/20"
      >
        <Check size={15} />
        Save Changes
      </button>
    </footer>
  );
}
