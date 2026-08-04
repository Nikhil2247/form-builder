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
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { SAMPLE_FORMS } from '@/lib/mockData';
import { FormConfig, FormQuestion, QuestionType } from '@/types/form';
import { EnterpriseNavbar } from '@/components/builder/EnterpriseNavbar';
import { LeftTreePanel } from '@/components/builder/LeftTreePanel';
import { EnterpriseFieldCard } from '@/components/builder/EnterpriseFieldCard';
import { FormRunner } from '@/components/builder/FormRunner';
import { ThemeCustomizer } from '@/components/builder/ThemeCustomizer';
import { LogicBuilder } from '@/components/builder/LogicBuilder';
import { X, Sparkles, Plus, Type, AlignLeft, Mail, Phone, Hash, Link as LinkIcon, CheckCircle2, CheckSquare, ListFilter, Star, Gauge, Sliders, Calendar, UploadCloud, PenTool, Grid, Heading as HeadingIcon } from 'lucide-react';
import { toast } from 'sonner';

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
  { type: 'SECTION_HEADER', label: 'Section Header Banner', keywords: ['section', 'header', 'banner', 'title'], icon: HeadingIcon },
];

import { useSearchParams, useRouter } from 'next/navigation';
import { fetchApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useUser } from '@/hooks/use-auth';

function FormBuilderInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const formId = searchParams.get('id');

  const [form, setForm] = useState<FormConfig>(SAMPLE_FORMS[0]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const [activeView, setActiveView] = useState<'BUILDER' | 'LOGIC'>('BUILDER');
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  const { data: session } = useUser();
  const orgId = session?.activeOrganization?.id;

  // Keyboard shortcut listener for slash command
  React.useEffect(() => {
    if (activeView !== 'BUILDER') return;
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
  }, [activeView]);

  // Load form on mount
  React.useEffect(() => {
    async function loadForm() {
      if (!formId || !orgId) {
        setIsLoading(false);
        return;
      }
      try {
        const res = await fetchApi(`/organizations/${orgId}/forms/${formId}`);
        const data = res.data?.form ?? res.data ?? res;
        setForm({
          id: data.id,
          title: data.title,
          description: data.description || '',
          isQuizMode: data.isQuizMode,
          theme: data.themeConfig || SAMPLE_FORMS[0].theme,
          pages: (data.pagesJson || []).filter((p: any) => p && !Array.isArray(p)),
          questions: (data.questionsJson || []).filter((q: any) => q && !Array.isArray(q) && q.id),
          logic: (data.logicJson || []).filter((l: any) => l && !Array.isArray(l)),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
        if (data.questionsJson?.length > 0) {
          setSelectedQuestionId(data.questionsJson[0].id);
        }
      } catch (error) {
        toast.error('Failed to load form');
      } finally {
        setIsLoading(false);
      }
    }
    if (orgId) {
      loadForm();
    }
  }, [formId, orgId]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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
      setHasUnsavedChanges(true);
    }
  };

  // Positional Add Question Handler
  const handleAddQuestion = (type: QuestionType, afterIndex?: number) => {
    const newId = `q-${Date.now()}`;
    const newQuestion: FormQuestion = {
      id: newId,
      type,
      label: type === 'SHORT_TEXT' ? 'Text Block' : type === 'SINGLE_CHOICE' ? 'Single Response' : `New ${type.replace(/_/g, ' ')}`,
      placeholder: 'User input placeholder...',
      required: false,
      validation: { required: false },
      colSpan: 2,
      pageNumber: 1,
      options: ['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'].includes(type)
        ? [
            { id: `opt-1`, label: 'Option 1', value: 'option_1' },
            { id: `opt-2`, label: 'Option 2', value: 'option_2' },
          ]
        : undefined,
    };

    setForm((prev) => {
      const questionsCopy = [...prev.questions];
      if (typeof afterIndex === 'number' && afterIndex >= 0 && afterIndex < questionsCopy.length) {
        // Insert right after the clicked card at position afterIndex + 1
        questionsCopy.splice(afterIndex + 1, 0, newQuestion);
      } else {
        // Append at the end if no afterIndex is specified
        questionsCopy.push(newQuestion);
      }
      return { ...prev, questions: questionsCopy };
    });

    setSelectedQuestionId(newId);
    setHasUnsavedChanges(true);
    setIsLeftPanelOpen(false); // Close on mobile after adding
  };

  const handleUpdateQuestion = (updated: FormQuestion) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.map((q) => (q.id === updated.id ? updated : q)),
    }));
    setHasUnsavedChanges(true);
  };

  const handleDeleteQuestion = (id: string) => {
    setForm((prev) => ({
      ...prev,
      questions: prev.questions.filter((q) => q.id !== id),
    }));
    if (selectedQuestionId === id) {
      setSelectedQuestionId(null);
    }
    setHasUnsavedChanges(true);
  };

  const handleAddPage = () => {
    const newPageNum = form.pages.length + 1;
    setForm((prev) => ({
      ...prev,
      pages: [...prev.pages, { pageNumber: newPageNum, title: `Page ${newPageNum}`, description: '' }]
    }));
    setHasUnsavedChanges(true);
  };

  const handleSaveChanges = async () => {
    try {
      if (formId) {
        await fetchApi(`/organizations/${orgId}/forms/${formId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: form.title,
            description: form.description,
            themeConfig: form.theme,
            pages: form.pages,
            questions: form.questions,
            logic: form.logic,
          }),
        });
        toast.success('Form changes saved successfully!');
      } else {
        const res = await fetchApi(`/organizations/${orgId}/forms`, {
          method: 'POST',
          body: JSON.stringify({
            title: form.title,
            description: form.description,
            themeConfig: form.theme,
            pages: form.pages,
            questions: form.questions,
            logic: form.logic,
          }),
        });
        const data = res.data?.form ?? res.data ?? res;
        toast.success('New form created!');
        router.replace(`/forms/builder?id=${data.id}`);
      }
      setHasUnsavedChanges(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save form');
    }
  };

  if (isLoading) {
    return <div className="flex h-screen items-center justify-center bg-background text-foreground">Loading...</div>;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background overflow-hidden relative">
      {/* Top Navbar */}
      <EnterpriseNavbar
        formTitle={form.title}
        onTitleChange={(newTitle) => {
          setForm((prev) => ({ ...prev, title: newTitle }));
          setHasUnsavedChanges(true);
        }}
        onPreview={() => setIsPreviewOpen(true)}
        onOpenTheme={() => setIsThemeOpen(true)}
        onOpenLogic={() => setActiveView(v => v === 'LOGIC' ? 'BUILDER' : 'LOGIC')}
        hasUnsavedChanges={hasUnsavedChanges}
        onSaveChanges={handleSaveChanges}
        onToggleLeftPanel={() => setIsLeftPanelOpen(true)}
      />

      {/* Main Two-Panel Layout */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Mobile Overlay for Left Panel */}
        {isLeftPanelOpen && (
          <div 
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40 md:hidden" 
            onClick={() => setIsLeftPanelOpen(false)} 
          />
        )}

        {/* Left Tree & Elements Palette Panel */}
        <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${isLeftPanelOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <LeftTreePanel
            questions={form.questions}
            selectedQuestionId={selectedQuestionId}
            onSelectQuestion={setSelectedQuestionId}
            onAddQuestion={(type) => handleAddQuestion(type)}
            onAddPage={handleAddPage}
            onClose={() => setIsLeftPanelOpen(false)}
          />
        </div>

        {/* Center Canvas / Logic View */}
        <main className="flex-1 overflow-y-auto bg-muted/30 relative">
          {activeView === 'LOGIC' ? (
            <LogicBuilder 
              form={form} 
              setForm={setForm} 
            />
          ) : (
            <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-3xl mx-auto pb-20">
              {/* Form Title Banner */}
              <Card className="p-6 shadow-sm border-border space-y-4">
              <Input
                type="text"
                value={form.title}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, title: e.target.value }));
                  setHasUnsavedChanges(true);
                }}
                className="text-2xl font-bold text-foreground w-full bg-transparent border-0 focus-visible:ring-0 focus-visible:border-b-2 focus-visible:border-primary px-0 rounded-none shadow-none h-auto"
              />
              <Input
                type="text"
                value={form.description}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, description: e.target.value }));
                  setHasUnsavedChanges(true);
                }}
                className="text-sm text-muted-foreground w-full bg-transparent border-0 focus-visible:ring-0 focus-visible:border-b-2 focus-visible:border-primary px-0 rounded-none shadow-none"
                placeholder="Form description or subtext..."
              />
            </Card>

            {/* Questions List */}
            {form.questions.length === 0 ? (
              <div className="border-2 border-dashed border-border rounded-xl p-12 text-center bg-card space-y-4 shadow-sm">
                <Sparkles size={32} className="mx-auto text-muted-foreground" />
                <div className="text-base font-semibold text-foreground">Your Form Canvas is Empty</div>
                <p className="text-sm text-muted-foreground">Click any field in the left palette to add your first question.</p>
                <Button
                  onClick={() => handleAddQuestion('SHORT_TEXT')}
                  className="mt-4 gap-2"
                >
                  <Plus size={16} /> Add Text Block
                </Button>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={form.questions.map((q) => q.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-6">
                    {form.questions.map((question, index) => (
                      <EnterpriseFieldCard
                        key={question.id}
                        question={question}
                        index={index}
                        isSelected={selectedQuestionId === question.id}
                        onSelect={() => setSelectedQuestionId(question.id)}
                        onUpdate={handleUpdateQuestion}
                        onDelete={() => handleDeleteQuestion(question.id)}
                        allQuestions={form.questions}
                        onAddInlineQuestion={(type, afterIndex) => handleAddQuestion(type, afterIndex)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
            
            {/* Quick Add Hint */}
            {form.questions.length > 0 && (
              <div className="text-center pt-8 pb-4">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-background border border-border shadow-sm text-sm text-muted-foreground">
                  <Sparkles size={14} className="text-primary" />
                  <span>Press <kbd className="font-sans px-1.5 py-0.5 rounded-md bg-muted text-xs font-bold text-foreground">{"/"}</kbd> anywhere to quickly add a new field</span>
                </div>
              </div>
            )}
          </div>
          )}
        </main>
      </div>

      {/* Enhanced Live Preview Modal */}
      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
          <Card className="max-w-2xl w-full p-6 shadow-xl space-y-6 max-h-[95vh] overflow-y-auto relative animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
                <h3 className="font-semibold text-foreground text-sm">Interactive Live Form Preview</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsPreviewOpen(false)}
              >
                <X size={18} />
              </Button>
            </div>
            <FormRunner form={form} onSubmitResponse={() => toast.success('Response successfully submitted in Live Preview mode!')} />
          </Card>
        </div>
      )}

      {/* Theme Settings Modal */}
      {isThemeOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
          <Card className="max-w-2xl w-full p-6 shadow-xl space-y-6 max-h-[95vh] overflow-y-auto relative animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between border-b border-border pb-4">
              <h3 className="font-semibold text-foreground text-sm">Form Theme & Styling Options</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsThemeOpen(false)}
              >
                <X size={18} />
              </Button>
            </div>
            <ThemeCustomizer form={form} setForm={setForm} />
          </Card>
        </div>
      )}
      {/* Slash Command Palette */}
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
                    handleAddQuestion(item.type as QuestionType);
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
    </div>
  );
}

export default function FormBuilderStudioPage() {
  return (
    <React.Suspense fallback={<div className="flex h-screen items-center justify-center bg-background text-foreground">Loading Studio...</div>}>
      <FormBuilderInner />
    </React.Suspense>
  );
}
