import React, { useState } from 'react';
import { FormQuestion, QuestionType } from '@/types/form';
import { 
  ChevronDown, 
  ChevronRight, 
  Pin, 
  Plus, 
  MessageSquare, 
  CheckCircle2, 
  AlignLeft, 
  Type, 
  UploadCloud, 
  ListFilter,
  Layers,
  CheckSquare,
  Star,
  Gauge,
  Sliders,
  Calendar,
  PenTool,
  Grid,
  Heading,
  Mail,
  Phone,
  Hash,
  Link as LinkIcon,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface LeftTreePanelProps {
  questions: FormQuestion[];
  selectedQuestionId: string | null;
  onSelectQuestion: (id: string) => void;
  onAddQuestion: (type: QuestionType) => void;
  onAddPage: () => void;
  onClose?: () => void;
}

interface PaletteCategory {
  category: string;
  items: Array<{ type: QuestionType; label: string; icon: any }>;
}

const CATEGORIZED_PALETTE: PaletteCategory[] = [
  {
    category: 'Basic Fields',
    items: [
      { type: 'SHORT_TEXT', label: 'Short Text Input', icon: Type },
      { type: 'LONG_TEXT', label: 'Paragraph / Textarea', icon: AlignLeft },
      { type: 'EMAIL', label: 'Email Address', icon: Mail },
      { type: 'PHONE', label: 'Phone Number', icon: Phone },
      { type: 'NUMBER', label: 'Numeric Limit Value', icon: Hash },
      { type: 'URL', label: 'Website Link URL', icon: LinkIcon },
    ],
  },
  {
    category: 'Selection Fields',
    items: [
      { type: 'SINGLE_CHOICE', label: 'Radio (Single Choice)', icon: CheckCircle2 },
      { type: 'MULTI_CHOICE', label: 'Checkbox (Multi Choice)', icon: CheckSquare },
      { type: 'DROPDOWN', label: 'Dropdown Select', icon: ListFilter },
    ],
  },
  {
    category: 'Rating & Evaluation',
    items: [
      { type: 'STAR_RATING', label: '5-Star Rating', icon: Star },
      { type: 'NPS', label: 'NPS Score (0-10)', icon: Gauge },
      { type: 'SLIDER', label: 'Range Slider', icon: Sliders },
    ],
  },
  {
    category: 'Advanced & Storage',
    items: [
      { type: 'DATE', label: 'Date Picker', icon: Calendar },
      { type: 'FILE_UPLOAD', label: 'MinIO File Upload', icon: UploadCloud },
      { type: 'SIGNATURE', label: 'Digital Signature', icon: PenTool },
      { type: 'MATRIX', label: 'Likert Scale Matrix', icon: Grid },
    ],
  },
  {
    category: 'Layout Banner',
    items: [
      { type: 'SECTION_HEADER', label: 'Section Header Banner', icon: Heading },
    ],
  },
];

export function LeftTreePanel({
  questions,
  selectedQuestionId,
  onSelectQuestion,
  onAddQuestion,
  onAddPage,
  onClose
}: LeftTreePanelProps) {
  const [activeTab, setActiveTab] = useState<'elements' | 'myform'>('elements');
  const [openPages, setOpenPages] = useState<Record<number, boolean>>({ 1: true, 2: true });

  const togglePage = (pageNum: number) => {
    setOpenPages(prev => ({ ...prev, [pageNum]: !prev[pageNum] }));
  };

  const getIconForType = (type: QuestionType) => {
    switch (type) {
      case 'SINGLE_CHOICE':
        return CheckCircle2;
      case 'MULTI_CHOICE':
        return CheckSquare;
      case 'LONG_TEXT':
        return AlignLeft;
      case 'FILE_UPLOAD':
        return UploadCloud;
      case 'DROPDOWN':
        return ListFilter;
      case 'STAR_RATING':
        return Star;
      case 'SIGNATURE':
        return PenTool;
      default:
        return Type;
    }
  };

  return (
    <aside className="w-64 border-r border-border bg-card flex flex-col shrink-0 h-full overflow-hidden">
      {/* Mobile Close Button */}
      {onClose && (
        <Button 
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="md:hidden absolute top-2 right-2 z-10"
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      {/* Tabs Bar */}
      <div className="flex border-b border-border text-xs font-semibold text-muted-foreground bg-muted/30">
        <button
          onClick={() => setActiveTab('elements')}
          className={`flex-1 py-3 px-3 text-center transition-colors cursor-pointer border-b-2 ${
            activeTab === 'elements'
              ? 'border-primary text-primary bg-background font-bold'
              : 'border-transparent hover:text-foreground'
          }`}
        >
          Elements
        </button>
        <button
          onClick={() => setActiveTab('myform')}
          className={`flex-1 py-3 px-3 text-center transition-colors cursor-pointer border-b-2 ${
            activeTab === 'myform'
              ? 'border-primary text-primary bg-background font-bold'
              : 'border-transparent hover:text-foreground'
          }`}
        >
          My Form ({questions.length})
        </button>
      </div>

      {/* Tab Contents */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {activeTab === 'elements' ? (
          /* All 17 Categorized Question Types */
          <div className="space-y-6">
            {CATEGORIZED_PALETTE.map((cat) => (
              <div key={cat.category} className="space-y-2">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  {cat.category}
                </span>
                <div className="space-y-1.5">
                  {cat.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.type}
                        onClick={() => onAddQuestion(item.type)}
                        className="w-full flex items-center gap-3 p-2 bg-background hover:bg-accent border border-border hover:border-primary/50 rounded-md text-left text-xs font-medium text-foreground transition-all cursor-pointer shadow-sm group"
                      >
                        <div className="w-7 h-7 rounded bg-muted flex items-center justify-center text-muted-foreground shrink-0 group-hover:text-primary transition-colors">
                          <Icon className="h-4 w-4" />
                        </div>
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Tree View of Pages & Questions Outline */
          <div className="space-y-4">
            {[1, 2].map((pageNum) => {
              const pageQuestions = questions.filter(q => (q.pageNumber || 1) === pageNum);
              const isOpen = openPages[pageNum] ?? true;

              return (
                <div key={pageNum} className="space-y-1.5">
                  <div
                    onClick={() => togglePage(pageNum)}
                    className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent cursor-pointer text-xs font-semibold text-foreground transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span>Page {pageNum} ({pageQuestions.length})</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="pl-4 space-y-1">
                      {pageQuestions.map((q) => {
                        const Icon = getIconForType(q.type);
                        const isSelected = selectedQuestionId === q.id;

                        return (
                          <div
                            key={q.id}
                            onClick={() => onSelectQuestion(q.id)}
                            className={`flex items-center justify-between py-2 px-2.5 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-primary/10 text-primary border border-primary/20'
                                : 'text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <Icon className={`h-3.5 w-3.5 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                              <span className="truncate">{q.label}</span>
                            </div>
                            {isSelected && <Pin className="h-3 w-3 text-primary shrink-0 opacity-80" />}
                          </div>
                        );
                      })}

                      {pageNum === 1 && (
                        <div
                          onClick={onAddPage}
                          className="flex items-center justify-center gap-2 mt-3 py-2 px-3 bg-muted/50 hover:bg-accent border border-border border-dashed rounded-md text-[10px] font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                        >
                          <Layers className="h-3.5 w-3.5" />
                          <span>+ Next Page Break</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
