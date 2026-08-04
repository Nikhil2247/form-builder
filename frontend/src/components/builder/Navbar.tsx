'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileSpreadsheet,
  Layers,
  Palette,
  Eye,
  BarChart3,
  RotateCcw,
  Sparkles,
  GitBranch,
  Bookmark
} from 'lucide-react';
import { FormConfig } from '@/types/form';
import { SAMPLE_FORMS } from '@/lib/mockData';

interface NavbarProps {
  form: FormConfig;
  setForm: React.Dispatch<React.SetStateAction<FormConfig>>;
  activeTab: 'builder' | 'logic' | 'theme' | 'preview' | 'submissions';
  setActiveTab: (tab: 'builder' | 'logic' | 'theme' | 'preview' | 'submissions') => void;
  onReset: () => void;
  submissionsCount: number;
  onExportExcel: () => void;
}

export function Navbar({
  form,
  setForm,
  activeTab,
  setActiveTab,
  onReset,
  submissionsCount,
  onExportExcel
}: NavbarProps) {
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);

  const handleSelectTemplate = (templateId: string) => {
    const found = SAMPLE_FORMS.find((t) => t.id === templateId);
    if (found) setForm(found);
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6">
        {/* Left: Brand Identity & Editable Title */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-rose-500 text-white shadow-md shadow-indigo-500/20">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                FormStudio
              </span>
              <Badge variant="outline" className="text-[9px] py-0">
                Studio Edition
              </Badge>
            </div>

            {isEditingTitle ? (
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                onBlur={() => setIsEditingTitle(false)}
                onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
                autoFocus
                className="h-6 rounded border border-indigo-500 bg-indigo-50 px-2 text-sm font-bold text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-white"
              />
            ) : (
              <h1
                onClick={() => setIsEditingTitle(true)}
                className="cursor-pointer text-sm font-bold text-slate-900 hover:text-indigo-600 dark:text-white"
              >
                {form.title}
              </h1>
            )}
          </div>
        </div>

        {/* Center: Segmented Navigation Pills */}
        <nav className="hidden md:flex items-center gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button
            onClick={() => setActiveTab('builder')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'builder'
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            Canvas Builder
          </button>

          <button
            onClick={() => setActiveTab('logic')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'logic'
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5" />
            Logic ({form.logic.length})
          </button>

          <button
            onClick={() => setActiveTab('theme')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'theme'
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            Design & Theme
          </button>

          <button
            onClick={() => setActiveTab('submissions')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'submissions'
                ? 'bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Submissions ({submissionsCount})
          </button>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Template Selector Dropdown */}
          <div className="hidden sm:flex items-center gap-1">
            <Bookmark className="h-3.5 w-3.5 text-slate-400" />
            <select
              onChange={(e) => handleSelectTemplate(e.target.value)}
              className="h-8 rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 cursor-pointer"
            >
              <option value="">Load Template...</option>
              <option value="customer-feedback-01">Customer Feedback Survey</option>
              <option value="tech-quiz-02">Coding Knowledge Quiz</option>
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setActiveTab('preview')}
            className="gap-1.5 text-xs font-semibold border-indigo-200 text-indigo-600 hover:bg-indigo-50"
          >
            <Eye className="h-4 w-4" /> Live Preview
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={onExportExcel}
            className="gap-1.5 text-xs font-semibold shadow-sm bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <FileSpreadsheet className="h-4 w-4" /> Export Excel
          </Button>
        </div>
      </div>
    </header>
  );
}
