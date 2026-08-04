'use client';

import React, { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { FormConfig, FormQuestion, QuestionType, FormPage } from '@/types/form';
import { QuestionCard } from '@/components/builder/QuestionCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { generateId } from '@/lib/utils';
import {
  Plus,
  Layers,
  GripHorizontal,
  Heading,
  Split,
  Trash2,
  Type,
  AlignLeft,
  Mail,
  Phone,
  Hash,
  Link as LinkIcon,
  CheckCircle2,
  CheckSquare,
  ListFilter,
  Star,
  Gauge,
  Sliders,
  Calendar,
  UploadCloud,
  PenTool,
  Grid
} from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

const COMMAND_ITEMS = [
  { type: 'SHORT_TEXT', label: 'Short Text Input', keywords: ['text', 'short', 'input', 'string'], icon: Type },
  { type: 'LONG_TEXT', label: 'Paragraph / Textarea', keywords: ['long', 'text', 'paragraph', 'textarea'], icon: AlignLeft },
  { type: 'EMAIL', label: 'Email Address', keywords: ['email', 'mail', 'address'], icon: Mail },
  { type: 'PHONE', label: 'Phone Number', keywords: ['phone', 'number', 'mobile'], icon: Phone },
  { type: 'NUMBER', label: 'Numeric Limit Value', keywords: ['number', 'numeric', 'integer', 'amount'], icon: Hash },
  { type: 'URL', label: 'Website Link URL', keywords: ['url', 'website', 'link'], icon: LinkIcon },
  { type: 'SINGLE_CHOICE', label: 'Radio (Single Choice)', keywords: ['radio', 'single', 'choice', 'select'], icon: CheckCircle2 },
  { type: 'MULTI_CHOICE', label: 'Checkbox (Multi Choice)', keywords: ['checkbox', 'multi', 'multiple', 'choice', 'select'], icon: CheckSquare },
  { type: 'DROPDOWN', label: 'Dropdown Select', keywords: ['dropdown', 'select', 'menu', 'list'], icon: ListFilter },
  { type: 'STAR_RATING', label: '5-Star Rating', keywords: ['star', 'rating', 'score'], icon: Star },
  { type: 'NPS', label: 'NPS Score (0-10)', keywords: ['nps', 'score', 'rating', 'net', 'promoter'], icon: Gauge },
  { type: 'SLIDER', label: 'Range Slider', keywords: ['slider', 'range', 'scale'], icon: Sliders },
  { type: 'DATE', label: 'Date Picker', keywords: ['date', 'picker', 'calendar', 'time'], icon: Calendar },
  { type: 'FILE_UPLOAD', label: 'MinIO File Upload', keywords: ['file', 'upload', 'minio', 'document', 'image'], icon: UploadCloud },
  { type: 'SIGNATURE', label: 'Digital Signature', keywords: ['signature', 'digital', 'sign', 'draw'], icon: PenTool },
  { type: 'MATRIX', label: 'Likert Scale Matrix', keywords: ['matrix', 'likert', 'scale', 'grid', 'table'], icon: Grid },
  { type: 'SECTION_HEADER', label: 'Section Header Banner', keywords: ['section', 'header', 'banner', 'title'], icon: Heading },
];

interface FormCanvasProps {
  form: FormConfig;
  setForm: React.Dispatch<React.SetStateAction<FormConfig>>;
  selectedQuestionId: string | null;
  setSelectedQuestionId: (id: string | null) => void;
  onAddQuestion: (type: QuestionType) => void;
}

export function FormCanvas({
  form,
  setForm,
  selectedQuestionId,
  setSelectedQuestionId,
  onAddQuestion
}: FormCanvasProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedPageFilter, setSelectedPageFilter] = useState<number | 'ALL'>('ALL');
  
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        setShowCommandPalette(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setForm((prev) => {
        const oldIndex = prev.questions.findIndex((q) => q.id === active.id);
        const newIndex = prev.questions.findIndex((q) => q.id === over.id);
        return {
          ...prev,
          questions: arrayMove(prev.questions, oldIndex, newIndex)
        };
      });
    }
    setActiveId(null);
  };

  const handleDragCancel = () => setActiveId(null);

  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= form.questions.length) return;

    setForm((prev) => ({
      ...prev,
      questions: arrayMove(prev.questions, index, newIndex)
    }));
  };

  const handleAddPage = () => {
    const newPageNum = form.pages.length + 1;
    const newPage: FormPage = {
      pageNumber: newPageNum,
      title: `Page ${newPageNum}`,
      description: 'Page section description'
    };
    setForm((prev) => ({ ...prev, pages: [...prev.pages, newPage] }));
    setSelectedPageFilter(newPageNum);
  };

  const handleDeletePage = (pageNum: number) => {
    if (form.pages.length <= 1) return;
    setForm((prev) => ({
      ...prev,
      pages: prev.pages.filter((p) => p.pageNumber !== pageNum),
      questions: prev.questions.map((q) =>
        q.pageNumber === pageNum ? { ...q, pageNumber: 1 } : q
      )
    }));
    setSelectedPageFilter('ALL');
  };

  const handleUpdateQuestion = (updated: FormQuestion) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => (q.id === updated.id ? updated : q))
    }));
  };

  const handleDuplicateQuestion = (q: FormQuestion) => {
    const duplicated: FormQuestion = {
      ...q,
      id: generateId('q'),
      label: `${q.label} (Copy)`
    };
    const index = form.questions.findIndex((item) => item.id === q.id);
    const newQuestions = [...form.questions];
    newQuestions.splice(index + 1, 0, duplicated);
    setForm((prev) => ({ ...prev, questions: newQuestions }));
    setSelectedQuestionId(duplicated.id);
  };

  const handleDeleteQuestion = (id: string) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((q) => q.id !== id)
    }));
    if (selectedQuestionId === id) setSelectedQuestionId(null);
  };

  const displayedQuestions =
    selectedPageFilter === 'ALL'
      ? form.questions
      : form.questions.filter((q) => (q.pageNumber || 1) === selectedPageFilter);

  const totalPoints = form.questions.reduce((sum, q) => sum + (q.points || 0), 0);
  const activeQuestion = form.questions.find((q) => q.id === activeId);

  return (
    <main
      className="relative flex-1 p-4 sm:p-6 bg-[#F8FAFC] dark:bg-slate-950 h-[calc(100vh-4rem)] overflow-y-auto"
    >
      <div className="mx-auto max-w-4xl space-y-4">
        {/* Form Header Card */}
        <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div
            className="h-2.5 w-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-500"
          />

          <div className="p-5 space-y-3">
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="Untitled Form"
              className="w-full bg-transparent text-xl font-bold text-slate-900 focus:outline-none focus:border-b-2 focus:border-indigo-600 px-1 dark:text-white"
            />

            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Form description"
              className="w-full bg-transparent text-xs text-slate-500 focus:outline-none focus:border-b focus:border-indigo-600 px-1 dark:text-slate-400"
            />

            {totalPoints > 0 && (
              <div className="pt-2 border-t border-slate-100 flex items-center gap-2 dark:border-slate-800">
                <Badge variant="default" className="text-xs bg-emerald-500 hover:bg-emerald-600 text-white">
                  Total Assigned Marks: {totalPoints} pts
                </Badge>
              </div>
            )}
          </div>
        </div>

        {/* Page Management Tabs Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setSelectedPageFilter('ALL')}
              className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                selectedPageFilter === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100/80 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              All Pages ({form.questions.length})
            </button>

            {form.pages.map((p) => {
              const pageCount = form.questions.filter((q) => (q.pageNumber || 1) === p.pageNumber).length;
              return (
                <div key={p.pageNumber} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedPageFilter(p.pageNumber)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                      selectedPageFilter === p.pageNumber
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    Page {p.pageNumber} ({pageCount})
                  </button>

                  {form.pages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeletePage(p.pageNumber)}
                      className="p-1 text-slate-400 hover:text-rose-500 cursor-pointer"
                      title={`Delete Page ${p.pageNumber}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <Button onClick={handleAddPage} variant="outline" size="sm" className="gap-1 text-xs font-bold">
            <Plus className="h-3.5 w-3.5" /> Add Page
          </Button>
        </div>

        {/* Questions List */}
        {form.questions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-12 text-center bg-white dark:border-slate-800 dark:bg-slate-900">
            <Layers className="h-10 w-10 text-slate-300 mb-2" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">No questions added yet</h3>
            <p className="text-xs text-slate-400 mt-1">Click the + button to add your first question.</p>
            <Button onClick={() => onAddQuestion('SINGLE_CHOICE')} className="mt-4 gap-2 bg-purple-600 text-white font-bold">
              <Plus className="h-4 w-4" /> Add Question
            </Button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={displayedQuestions.map((q) => q.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {displayedQuestions.map((question, index) => (
                  <React.Fragment key={question.id}>
                    {/* Show Page Break Divider when viewing All Pages */}
                    {selectedPageFilter === 'ALL' &&
                      index > 0 &&
                      (question.pageNumber || 1) !== (displayedQuestions[index - 1].pageNumber || 1) && (
                        <div className="flex items-center gap-3 my-4">
                          <div className="h-[1px] flex-1 bg-slate-300 dark:bg-slate-800" />
                          <Badge variant="outline" className="gap-1 bg-white text-slate-600 dark:bg-slate-900">
                            <Split className="h-3 w-3 text-purple-600" /> Section Break: Page {question.pageNumber}
                          </Badge>
                          <div className="h-[1px] flex-1 bg-slate-300 dark:bg-slate-800" />
                        </div>
                      )}

                    <QuestionCard
                      question={question}
                      index={index}
                      totalQuestions={displayedQuestions.length}
                      pages={form.pages}
                      isSelected={selectedQuestionId === question.id}
                      onSelect={() => setSelectedQuestionId(question.id)}
                      onDuplicate={() => handleDuplicateQuestion(question)}
                      onDelete={() => handleDeleteQuestion(question.id)}
                      onMoveUp={() => handleMoveQuestion(index, 'up')}
                      onMoveDown={() => handleMoveQuestion(index, 'down')}
                      onUpdate={handleUpdateQuestion}
                    />
                  </React.Fragment>
                ))}
              </div>
            </SortableContext>

            {/* Floating Drag Overlay */}
            <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
              {activeQuestion ? (
                <div className="rounded-xl border-2 border-purple-600 bg-white p-4 shadow-2xl scale-102 cursor-grabbing dark:bg-slate-900">
                  <div className="flex items-center gap-2">
                    <GripHorizontal className="h-4 w-4 text-purple-600" />
                    <span className="text-xs font-bold text-purple-600">{activeQuestion.label}</span>
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Floating Action Dock */}
      <div className="fixed bottom-8 right-8 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-800 dark:bg-slate-900 z-40">
        <button
          type="button"
          onClick={() => onAddQuestion('SINGLE_CHOICE')}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white shadow-md hover:bg-purple-700 active:scale-95 transition-all cursor-pointer"
          title="Add Question"
        >
          <Plus className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={() => onAddQuestion('SECTION_HEADER')}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          title="Add Section Title Banner"
        >
          <Heading className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={handleAddPage}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
          title="Add Page / Section Break"
        >
          <Split className="h-5 w-5" />
        </button>
      </div>
      
      <CommandDialog open={showCommandPalette} onOpenChange={setShowCommandPalette}>
        <CommandInput placeholder="Type a command or search for a field type..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Form Fields (Press Enter to add)">
            {COMMAND_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem
                  key={item.type}
                  value={`${item.label} ${item.keywords.join(' ')}`}
                  onSelect={() => {
                    onAddQuestion(item.type as QuestionType);
                    setShowCommandPalette(false);
                  }}
                  className="gap-2 cursor-pointer"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span>{item.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </main>
  );
}
