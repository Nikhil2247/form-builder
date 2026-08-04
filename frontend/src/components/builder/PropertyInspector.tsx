'use client';

import React from 'react';
import { FormQuestion, QuestionOption, FormPage } from '@/types/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { generateId } from '@/lib/utils';
import {
  X,
  Plus,
  Trash2,
  CheckSquare,
  Sliders,
  Sparkles,
  LayoutGrid,
  Trophy,
  Check,
  HelpCircle,
  Layers
} from 'lucide-react';

interface PropertyInspectorProps {
  question: FormQuestion | null;
  pages: FormPage[];
  isQuizMode?: boolean;
  onUpdate: (updated: FormQuestion) => void;
  onClose: () => void;
}

export function PropertyInspector({
  question,
  pages = [],
  isQuizMode,
  onUpdate,
  onClose
}: PropertyInspectorProps) {
  if (!question) {
    return (
      <aside className="w-80 flex-shrink-0 border-l border-slate-200 bg-slate-50/50 p-6 text-center text-slate-400 dark:border-slate-800 dark:bg-slate-900/50 h-[calc(100vh-4rem)] overflow-y-auto hidden lg:flex flex-col items-center justify-center">
        <Sparkles className="h-8 w-8 mb-2 text-slate-300 dark:text-slate-700" />
        <p className="text-xs font-medium">Select a question card on the canvas to inspect & edit its properties.</p>
      </aside>
    );
  }

  const handleOptionChange = (optionId: string, label: string) => {
    const updatedOptions = (question.options || []).map((opt) =>
      opt.id === optionId ? { ...opt, label, value: label.toLowerCase().replace(/\s+/g, '_') } : opt
    );
    onUpdate({ ...question, options: updatedOptions });
  };

  const handleToggleCorrectOption = (optionId: string) => {
    const updatedOptions = (question.options || []).map((opt) => {
      if (question.type === 'SINGLE_CHOICE' || question.type === 'DROPDOWN') {
        return { ...opt, isCorrect: opt.id === optionId ? !opt.isCorrect : false };
      }
      return opt.id === optionId ? { ...opt, isCorrect: !opt.isCorrect } : opt;
    });
    onUpdate({ ...question, options: updatedOptions });
  };

  const handleAddOption = () => {
    const newCount = (question.options || []).length + 1;
    const newOpt: QuestionOption = {
      id: generateId('opt'),
      label: `Option ${newCount}`,
      value: `option_${newCount}`,
      isCorrect: false
    };
    onUpdate({ ...question, options: [...(question.options || []), newOpt] });
  };

  const handleRemoveOption = (optionId: string) => {
    const updatedOptions = (question.options || []).filter((opt) => opt.id !== optionId);
    onUpdate({ ...question, options: updatedOptions });
  };

  const handleMatrixRowChange = (index: number, val: string) => {
    const rows = [...(question.matrixRows || [])];
    rows[index] = val;
    onUpdate({ ...question, matrixRows: rows });
  };

  const handleAddMatrixRow = () => {
    const rows = [...(question.matrixRows || []), `Row ${(question.matrixRows || []).length + 1}`];
    onUpdate({ ...question, matrixRows: rows });
  };

  const handleRemoveMatrixRow = (index: number) => {
    const rows = (question.matrixRows || []).filter((_, i) => i !== index);
    onUpdate({ ...question, matrixRows: rows });
  };

  return (
    <aside className="w-80 flex-shrink-0 border-l border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 h-[calc(100vh-4rem)] overflow-y-auto">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Field Inspector</h2>
            <Badge variant="outline" className="text-[10px]">
              {question.type}
            </Badge>
          </div>
          <p className="text-[11px] text-slate-500">Edit properties & quiz answer keys</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-5 text-xs">
        {/* Page Assignment Selector */}
        <div>
          <label className="mb-1 font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
            <Layers className="h-3.5 w-3.5 text-indigo-500" /> Assign to Page
          </label>
          <select
            value={question.pageNumber || 1}
            onChange={(e) => onUpdate({ ...question, pageNumber: Number(e.target.value) })}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          >
            {(pages || []).map((p) => (
              <option key={p.pageNumber} value={p.pageNumber}>
                Page {p.pageNumber}: {p.title}
              </option>
            ))}
          </select>
        </div>

        {/* Quiz Answer Key Section (when Quiz Mode is ON) */}
        {isQuizMode && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/30 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
                <Trophy className="h-4 w-4 text-emerald-600" /> Quiz Answer Key
              </h3>
            </div>

            <div>
              <label className="mb-1 block font-semibold text-emerald-900 dark:text-emerald-300">
                Points for Correct Answer
              </label>
              <Input
                type="number"
                min={1}
                max={100}
                value={question.points || 1}
                onChange={(e) => onUpdate({ ...question, points: Math.max(1, Number(e.target.value)) })}
                className="bg-white dark:bg-slate-900"
              />
            </div>

            {['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'].includes(question.type) && (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                Click the checkmark next to options below to select the correct answer(s).
              </p>
            )}

            {['SHORT_TEXT', 'NUMBER', 'EMAIL'].includes(question.type) && (
              <div>
                <label className="mb-1 block font-semibold text-emerald-900 dark:text-emerald-300">
                  Exact Correct Text/Value
                </label>
                <Input
                  value={String(question.correctAnswer || '')}
                  onChange={(e) => onUpdate({ ...question, correctAnswer: e.target.value })}
                  placeholder="e.g., Paris, 42..."
                  className="bg-white dark:bg-slate-900"
                />
              </div>
            )}

            <div>
              <label className="mb-1 block font-semibold text-emerald-900 dark:text-emerald-300">
                Answer Explanation (Shown after submit)
              </label>
              <Textarea
                value={question.explanation || ''}
                onChange={(e) => onUpdate({ ...question, explanation: e.target.value })}
                placeholder="Explain why this answer is correct..."
                rows={2}
                className="bg-white dark:bg-slate-900 text-xs"
              />
            </div>
          </div>
        )}

        {/* Label & Description */}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
              Question Title / Label
            </label>
            <Input
              value={question.label}
              onChange={(e) => onUpdate({ ...question, label: e.target.value })}
              placeholder="e.g., What is your full name?"
            />
          </div>

          <div>
            <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
              Description / Instructions (Optional)
            </label>
            <Textarea
              value={question.description || ''}
              onChange={(e) => onUpdate({ ...question, description: e.target.value })}
              placeholder="Add extra guidance for respondent..."
              rows={2}
            />
          </div>

          {['SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'EMAIL', 'PHONE', 'URL'].includes(question.type) && (
            <div>
              <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                Placeholder Text
              </label>
              <Input
                value={question.placeholder || ''}
                onChange={(e) => onUpdate({ ...question, placeholder: e.target.value })}
                placeholder="e.g., Type your answer here..."
              />
            </div>
          )}

          {/* Slider Min/Max settings */}
          {question.type === 'SLIDER' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">Min Value</label>
                <Input
                  type="number"
                  value={question.sliderMin ?? 0}
                  onChange={(e) => onUpdate({ ...question, sliderMin: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">Max Value</label>
                <Input
                  type="number"
                  value={question.sliderMax ?? 100}
                  onChange={(e) => onUpdate({ ...question, sliderMax: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
        </div>

        {/* Layout Grid Settings */}
        <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
          <label className="mb-2 block font-semibold text-slate-700 dark:text-slate-300">
            Layout Column Span
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onUpdate({ ...question, colSpan: 1 })}
              className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-all ${
                question.colSpan === 1 || !question.colSpan
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'border-slate-200 text-slate-600 dark:border-slate-800'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Half Width
            </button>
            <button
              onClick={() => onUpdate({ ...question, colSpan: 2 })}
              className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-all ${
                question.colSpan === 2
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
                  : 'border-slate-200 text-slate-600 dark:border-slate-800'
              }`}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Full Width
            </button>
          </div>
        </div>

        {/* Validation Rules */}
        <div className="border-t border-slate-100 pt-4 dark:border-slate-800 space-y-3">
          <h3 className="font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
            Validation Rules
          </h3>

          <label className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 dark:border-slate-800 cursor-pointer">
            <span className="font-medium text-slate-800 dark:text-slate-200">Required Response</span>
            <input
              type="checkbox"
              checked={question.validation?.required || false}
              onChange={(e) =>
                onUpdate({
                  ...question,
                  validation: { ...question.validation, required: e.target.checked }
                })
              }
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
          </label>
        </div>

        {/* Options Manager for SINGLE_CHOICE / MULTI_CHOICE / DROPDOWN */}
        {['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'].includes(question.type) && (
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Answer Options & Correct Answer
              </label>
              <Button variant="ghost" size="sm" onClick={handleAddOption} className="h-6 px-2 text-[11px]">
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>

            <div className="space-y-2">
              {question.options?.map((opt, i) => (
                <div key={opt.id} className="flex items-center gap-1.5">
                  {isQuizMode && (
                    <button
                      type="button"
                      onClick={() => handleToggleCorrectOption(opt.id)}
                      className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
                        opt.isCorrect
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-300 bg-white text-slate-400 hover:border-emerald-400'
                      }`}
                      title={opt.isCorrect ? 'Marked as Correct' : 'Click to set as Correct Answer'}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <Input
                    value={opt.label}
                    onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                    className="h-8 text-xs"
                  />
                  {(question.options || []).length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleRemoveOption(opt.id)}
                      className="h-7 w-7 text-rose-500 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Matrix Rows Config */}
        {question.type === 'MATRIX' && (
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="mb-2 flex items-center justify-between">
              <label className="font-semibold text-slate-700 dark:text-slate-300">
                Likert Scale Matrix Rows
              </label>
              <Button variant="ghost" size="sm" onClick={handleAddMatrixRow} className="h-6 px-2 text-[11px]">
                <Plus className="h-3 w-3 mr-1" /> Add Row
              </Button>
            </div>

            <div className="space-y-2">
              {question.matrixRows?.map((row, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Input
                    value={row}
                    onChange={(e) => handleMatrixRowChange(i, e.target.value)}
                    className="h-8 text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveMatrixRow(i)}
                    className="h-7 w-7 text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
