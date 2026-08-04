'use client';

import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FormQuestion, QuestionType, QuestionOption, FormPage } from '@/types/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { generateId } from '@/lib/utils';
import {
  GripVertical,
  Copy,
  Trash2,
  Check,
  Key,
  Plus,
  X,
  Type,
  AlignLeft,
  CheckCircle2,
  CheckSquare,
  ListFilter,
  Star,
  Sliders,
  Calendar,
  UploadCloud,
  PenTool,
  Grid,
  Heading,
  LayoutGrid,
  Sparkles,
  ChevronUp,
  ChevronDown
} from 'lucide-react';

interface QuestionCardProps {
  question: FormQuestion;
  index: number;
  totalQuestions: number;
  pages: FormPage[];
  isSelected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (updated: FormQuestion) => void;
}

const QUESTION_TYPES: Array<{ type: QuestionType; label: string; icon: React.ElementType }> = [
  { type: 'SHORT_TEXT', label: 'Short Text', icon: Type },
  { type: 'LONG_TEXT', label: 'Paragraph Text', icon: AlignLeft },
  { type: 'SINGLE_CHOICE', label: 'Single Choice (Radio)', icon: CheckCircle2 },
  { type: 'MULTI_CHOICE', label: 'Multiple Choice (Checkbox)', icon: CheckSquare },
  { type: 'DROPDOWN', label: 'Dropdown Select', icon: ListFilter },
  { type: 'STAR_RATING', label: 'Star Rating', icon: Star },
  { type: 'SLIDER', label: 'Range Slider', icon: Sliders },
  { type: 'DATE', label: 'Date Picker', icon: Calendar },
  { type: 'FILE_UPLOAD', label: 'File Upload', icon: UploadCloud },
  { type: 'SIGNATURE', label: 'Digital Signature', icon: PenTool },
  { type: 'MATRIX', label: 'Likert Matrix Grid', icon: Grid },
  { type: 'SECTION_HEADER', label: 'Section Header Banner', icon: Heading }
];

export function QuestionCard({
  question,
  index,
  totalQuestions,
  pages,
  isSelected,
  onSelect,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onUpdate
}: QuestionCardProps) {
  const [isAnswerKeyMode, setIsAnswerKeyMode] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms cubic-bezier(0.2, 0, 0, 1)',
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 10 : 1,
    gridColumn: question.colSpan === 1 ? 'span 1 / span 1' : 'span 2 / span 2'
  };

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

  const getTypeIcon = () => {
    const item = QUESTION_TYPES.find((t) => t.type === question.type);
    return item ? item.icon : Type;
  };

  const Icon = getTypeIcon();
  const hasAssignedMarks = (question.points || 0) > 0;

  // Section Header Card View
  if (question.type === 'SECTION_HEADER') {
    return (
      <div
        ref={setNodeRef}
        style={style}
        onClick={onSelect}
        className={`group relative col-span-2 rounded-2xl border bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white shadow-md transition-all ${
          isSelected ? 'ring-2 ring-indigo-400 shadow-indigo-500/20' : 'border-slate-800'
        }`}
      >
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab p-1 text-slate-400 hover:text-white active:cursor-grabbing"
              title="Drag card"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <Badge variant="outline" className="border-indigo-400 text-indigo-300 text-[10px]">
              Section Heading Banner
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={question.pageNumber || 1}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onUpdate({ ...question, pageNumber: Number(e.target.value) })}
              className="h-6 rounded border border-slate-700 bg-slate-800 px-2 text-[11px] font-semibold text-slate-200 focus:outline-none"
            >
              {pages.map((p) => (
                <option key={p.pageNumber} value={p.pageNumber}>
                  Page {p.pageNumber}
                </option>
              ))}
            </select>
            <button type="button" onClick={onDuplicate} className="text-slate-400 hover:text-white p-1">
              <Copy className="h-4 w-4" />
            </button>
            <button type="button" onClick={onDelete} className="text-slate-400 hover:text-rose-400 p-1">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <input
          type="text"
          value={question.label}
          onChange={(e) => onUpdate({ ...question, label: e.target.value })}
          className="w-full bg-transparent text-xl font-black text-white focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded px-1"
          placeholder="Section Title..."
        />
        <input
          type="text"
          value={question.description || ''}
          onChange={(e) => onUpdate({ ...question, description: e.target.value })}
          className="mt-1 w-full bg-transparent text-xs text-indigo-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded px-1"
          placeholder="Section description or subtext..."
        />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group relative rounded-2xl border bg-white p-5 shadow-sm transition-all dark:bg-slate-900 ${
        isDragging
          ? 'border-indigo-500 shadow-2xl scale-[1.01]'
          : isSelected
          ? 'border-indigo-500 ring-2 ring-indigo-500/20 shadow-md'
          : 'border-slate-200 hover:border-indigo-300 dark:border-slate-800'
      } ${question.colSpan === 2 ? 'col-span-2' : 'col-span-1'}`}
    >
      {/* Top Header Controls */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Drag Handle & Reorder */}
          <div className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
            <button
              {...attributes}
              {...listeners}
              className="cursor-grab p-1 text-slate-400 hover:text-slate-700 active:cursor-grabbing"
              title="Drag & Drop"
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={index === 0}
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp();
              }}
              className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-30"
              title="Move Up"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={index === totalQuestions - 1}
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown();
              }}
              className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-30"
              title="Move Down"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-50 text-xs font-bold text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
            Q{index + 1}
          </span>

          {/* Page Selector Dropdown */}
          <select
            value={question.pageNumber || 1}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onUpdate({ ...question, pageNumber: Number(e.target.value) })}
            className="h-6 rounded border border-slate-200 bg-slate-50 px-1.5 text-[11px] font-semibold text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
            title="Assigned Page"
          >
            {pages.map((p) => (
              <option key={p.pageNumber} value={p.pageNumber}>
                Page {p.pageNumber}
              </option>
            ))}
          </select>

          {/* Grid Span Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUpdate({ ...question, colSpan: question.colSpan === 2 ? 1 : 2 });
            }}
            className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 dark:bg-slate-800 dark:text-slate-400"
            title="Toggle Grid Width"
          >
            <LayoutGrid className="h-3 w-3" />
            <span>{question.colSpan === 2 ? 'Full Width' : 'Half Width'}</span>
          </button>
        </div>

        {/* Question Type Dropdown Selector */}
        <select
          value={question.type}
          onChange={(e) => onUpdate({ ...question, type: e.target.value as QuestionType })}
          className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 cursor-pointer"
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Answer Key Editing Mode View */}
      {isAnswerKeyMode ? (
        <div className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
          <div className="flex items-center justify-between border-b border-emerald-200/60 pb-3 dark:border-emerald-900/60">
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-emerald-600" />
              <span className="font-bold text-xs text-emerald-900 dark:text-emerald-300">
                Answer Key & Marks Assignment
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Points:</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={question.points || 0}
                onChange={(e) => onUpdate({ ...question, points: Math.max(0, Number(e.target.value)) })}
                className="h-8 w-16 bg-white text-xs font-bold text-center dark:bg-slate-900"
              />
            </div>
          </div>

          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            Select the correct answer option(s) by clicking the checkmark box:
          </p>

          {['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'].includes(question.type) && (
            <div className="space-y-2">
              {question.options?.map((opt) => (
                <div
                  key={opt.id}
                  onClick={() => handleToggleCorrectOption(opt.id)}
                  className={`flex items-center justify-between rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                    opt.isCorrect
                      ? 'border-emerald-500 bg-emerald-100/80 font-bold text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-200'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-emerald-50/50 dark:border-slate-800 dark:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        opt.isCorrect
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {opt.isCorrect && <Check className="h-3 w-3" />}
                    </div>
                    <span>{opt.label}</span>
                  </div>

                  {opt.isCorrect && (
                    <Badge variant="default" className="text-[10px] py-0 bg-emerald-500 hover:bg-emerald-600 text-white">
                      Correct Answer
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}

          {['SHORT_TEXT', 'NUMBER', 'EMAIL'].includes(question.type) && (
            <div>
              <label className="mb-1 block font-semibold text-emerald-900 text-xs">
                Exact Correct Answer Text
              </label>
              <Input
                value={String(question.correctAnswer || '')}
                onChange={(e) => onUpdate({ ...question, correctAnswer: e.target.value })}
                placeholder="e.g. Paris, 100..."
                className="h-8 text-xs bg-white dark:bg-slate-900"
              />
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              size="sm"
              variant="default"
              onClick={() => setIsAnswerKeyMode(false)}
              className="gap-1 font-bold text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Check className="h-4 w-4" /> Done
            </Button>
          </div>
        </div>
      ) : (
        /* Normal Question Editing View */
        <div className="space-y-3">
          {/* Question Title & Description */}
          <div className="space-y-1">
            <input
              type="text"
              value={question.label}
              onChange={(e) => onUpdate({ ...question, label: e.target.value })}
              className="w-full font-bold text-slate-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 dark:text-white"
              placeholder="Question Title..."
            />
            <input
              type="text"
              value={question.description || ''}
              onChange={(e) => onUpdate({ ...question, description: e.target.value })}
              className="w-full text-xs text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 dark:text-slate-400"
              placeholder="Add optional subtext or guidance..."
            />
          </div>

          {/* Choice Options Editor */}
          {['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'].includes(question.type) && (
            <div className="space-y-2 pt-1">
              {question.options?.map((opt) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <div
                    className={`h-4 w-4 rounded border border-slate-300 flex-shrink-0 ${
                      question.type === 'SINGLE_CHOICE' ? 'rounded-full' : ''
                    }`}
                  />
                  <input
                    type="text"
                    value={opt.label}
                    onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                    className="flex-1 bg-transparent text-xs text-slate-800 focus:outline-none focus:border-b focus:border-indigo-500 dark:text-slate-200"
                  />
                  {opt.isCorrect && (
                    <Badge variant="default" className="text-[9px] py-0 bg-emerald-500 hover:bg-emerald-600 text-white">
                      Correct
                    </Badge>
                  )}
                  {(question.options || []).length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOption(opt.id)}
                      className="text-slate-400 hover:text-rose-500 p-1"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={handleAddOption}
                className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 pt-1 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" /> Add option
              </button>
            </div>
          )}

          {/* Non-Choice Types Preview */}
          {['SHORT_TEXT', 'EMAIL', 'PHONE', 'NUMBER', 'URL'].includes(question.type) && (
            <div className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-950">
              User text response input
            </div>
          )}

          {question.type === 'LONG_TEXT' && (
            <div className="h-16 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-950">
              User paragraph response input
            </div>
          )}

          {/* Bottom Card Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            {/* Left: Answer Key Button */}
            <button
              type="button"
              onClick={() => setIsAnswerKeyMode(true)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                hasAssignedMarks
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950 dark:text-indigo-300'
              }`}
            >
              <Key className="h-3.5 w-3.5" />
              <span>Answer key ({question.points || 0} pts)</span>
            </button>

            {/* Right: Actions */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onDuplicate}
                className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
                title="Duplicate Question"
              >
                <Copy className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onDelete}
                className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                title="Delete Question"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800" />

              <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer dark:text-slate-300">
                <span>Required</span>
                <input
                  type="checkbox"
                  checked={question.validation?.required || false}
                  onChange={(e) =>
                    onUpdate({
                      ...question,
                      validation: { ...question.validation, required: e.target.checked }
                    })
                  }
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
