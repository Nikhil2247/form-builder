'use client';

import React from 'react';
import { QuestionType } from '@/types/form';
import {
  Type,
  AlignLeft,
  Hash,
  Mail,
  Phone,
  Link,
  CheckCircle2,
  ListFilter,
  CheckSquare,
  Star,
  Gauge,
  Sliders,
  Calendar,
  UploadCloud,
  PenTool,
  Grid,
  Heading
} from 'lucide-react';

interface PaletteItem {
  type: QuestionType;
  label: string;
  description: string;
  icon: React.ElementType;
  category: 'Basic' | 'Selection' | 'Rating' | 'Advanced' | 'Layout';
}

const PALETTE_ITEMS: PaletteItem[] = [
  { type: 'SHORT_TEXT', label: 'Short Text', description: 'Single line text input', icon: Type, category: 'Basic' },
  { type: 'LONG_TEXT', label: 'Paragraph / Textarea', description: 'Multi-line detailed text response', icon: AlignLeft, category: 'Basic' },
  { type: 'EMAIL', label: 'Email Address', description: 'Validated email input', icon: Mail, category: 'Basic' },
  { type: 'PHONE', label: 'Phone Number', description: 'Telephone or mobile input', icon: Phone, category: 'Basic' },
  { type: 'NUMBER', label: 'Number', description: 'Numeric values & limits', icon: Hash, category: 'Basic' },
  { type: 'URL', label: 'Website URL', description: 'Web link input', icon: Link, category: 'Basic' },

  { type: 'SINGLE_CHOICE', label: 'Radio (Single Choice)', description: 'Select one from options', icon: CheckCircle2, category: 'Selection' },
  { type: 'MULTI_CHOICE', label: 'Checkbox (Multiple Choice)', description: 'Select multiple items', icon: CheckSquare, category: 'Selection' },
  { type: 'DROPDOWN', label: 'Dropdown Select', description: 'Compact dropdown list', icon: ListFilter, category: 'Selection' },

  { type: 'STAR_RATING', label: 'Star Rating', description: '5-star evaluation scale', icon: Star, category: 'Rating' },
  { type: 'NPS', label: 'Net Promoter Score (NPS)', description: '0-10 Recommendation score', icon: Gauge, category: 'Rating' },
  { type: 'SLIDER', label: 'Range Slider', description: 'Draggable numerical range', icon: Sliders, category: 'Rating' },

  { type: 'DATE', label: 'Date Picker', description: 'Calendar date selection', icon: Calendar, category: 'Advanced' },
  { type: 'FILE_UPLOAD', label: 'File Upload', description: 'Document or image submission', icon: UploadCloud, category: 'Advanced' },
  { type: 'SIGNATURE', label: 'Signature Pad', description: 'Digital touch/mouse signature', icon: PenTool, category: 'Advanced' },
  { type: 'MATRIX', label: 'Likert Scale Matrix', description: 'Multi-row evaluation grid', icon: Grid, category: 'Advanced' },

  { type: 'SECTION_HEADER', label: 'Section Header', description: 'Visual header & instructions', icon: Heading, category: 'Layout' }
];

interface QuestionPaletteProps {
  onAddQuestion: (type: QuestionType) => void;
}

export function QuestionPalette({ onAddQuestion }: QuestionPaletteProps) {
  const categories: Array<'Basic' | 'Selection' | 'Rating' | 'Advanced' | 'Layout'> = [
    'Basic',
    'Selection',
    'Rating',
    'Advanced',
    'Layout'
  ];

  return (
    <div className="w-full space-y-4">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Question Palette
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Click any field to add it to your canvas.
        </p>
      </div>

      <div className="space-y-6">
        {categories.map((category) => {
          const items = PALETTE_ITEMS.filter((i) => i.category === category);
          return (
            <div key={category}>
              <h3 className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                {category} Fields
              </h3>
              <div className="grid grid-cols-1 gap-2">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.type}
                      onClick={() => onAddQuestion(item.type)}
                      className="group flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 text-left transition-all hover:border-indigo-400 hover:shadow-sm hover:shadow-indigo-500/10 active:scale-[0.98] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:bg-indigo-950 dark:group-hover:text-indigo-400">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-slate-800 group-hover:text-indigo-600 dark:text-slate-200 dark:group-hover:text-indigo-400">
                          {item.label}
                        </div>
                        <div className="truncate text-[10px] text-slate-400">
                          {item.description}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
