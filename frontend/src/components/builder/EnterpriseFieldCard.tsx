'use client';

import React, { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { QuestionType, FormQuestion, QuestionOption } from '@/types/form';
import { 
  GripVertical, 
  Pin, 
  Trash2, 
  Link as LinkIcon,
  Plus,
  X,
  Star,
  UploadCloud,
  PenTool,
  Calendar,
  Key,
  Check,
  CheckCircle2,
  Hash,
  ListFilter
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface EnterpriseFieldCardProps {
  question: FormQuestion;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onUpdate: (updated: FormQuestion) => void;
  onDelete: () => void;
  allQuestions: FormQuestion[];
  onAddInlineQuestion?: (type: QuestionType, afterIndex: number) => void;
}

export function EnterpriseFieldCard({
  question,
  index,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  allQuestions,
  onAddInlineQuestion
}: EnterpriseFieldCardProps) {
  const [isAnswerKeyOpen, setIsAnswerKeyOpen] = useState(false);
  const [logicRules, setLogicRules] = useState([
    { id: '1', whenQuestion: 'Single Response', operator: 'Equals', value: '' },
  ]);

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
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 20 : 1,
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
      id: `opt-${Date.now()}`,
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

  const addConditionRule = () => {
    setLogicRules(prev => [...prev, { id: String(Date.now()), whenQuestion: 'Single Response', operator: 'Equals', value: '' }]);
  };

  const removeConditionRule = (id: string) => {
    setLogicRules(prev => prev.filter(r => r.id !== id));
  };

  return (
    <div ref={setNodeRef} style={style} className="space-y-4 font-sans">
      <Card
        onClick={onSelect}
        className={`transition-all p-5 shadow-sm space-y-4 ${
          isSelected
            ? 'border-primary ring-1 ring-primary'
            : 'hover:border-primary/50'
        }`}
      >
        {/* Card Header Bar */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              {...attributes}
              {...listeners}
              className="p-1 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing rounded-md hover:bg-accent"
              title="Drag to reorder card"
            >
              <GripVertical size={16} />
            </button>

            <span className="text-xs font-bold text-muted-foreground">Q{index + 1}</span>
            <Pin size={13} className="text-primary" />
            
            <Input
              type="text"
              value={question.label}
              onChange={(e) => onUpdate({ ...question, label: e.target.value })}
              className="font-bold text-foreground text-sm border-0 focus-visible:ring-0 focus-visible:border-b focus-visible:border-primary px-1 rounded-none bg-transparent shadow-none w-auto min-w-[200px]"
            />

            <Badge variant="outline" className="text-[10px] bg-primary/5 text-primary">Custom field</Badge>
            <Badge variant="outline" className="text-[10px] bg-secondary text-secondary-foreground">Internal</Badge>
          </div>

          {/* Right Controls: Required Switch, Quiz Answer Key, Delete */}
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setIsAnswerKeyOpen(!isAnswerKeyOpen);
              }}
              className={`gap-1.5 h-7 px-2 text-xs font-semibold ${(question.points || 0) > 0 ? 'bg-primary/10 text-primary border-primary/20' : ''}`}
            >
              <Key size={13} />
              <span>{question.points || 0} pts</span>
            </Button>

            <div className="flex items-center space-x-2">
              <Switch 
                id={`required-${question.id}`}
                checked={question.validation?.required || false}
                onCheckedChange={(checked) => onUpdate({ ...question, validation: { ...question.validation, required: checked } })}
              />
              <Label htmlFor={`required-${question.id}`} className="text-xs font-medium cursor-pointer">
                Required
              </Label>
            </div>

            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={onDelete} title="Delete Field">
              <Trash2 size={14} />
            </Button>
          </div>
        </div>

        {/* Quiz Answer Key Assign Drawer */}
        {isAnswerKeyOpen && (
          <div className="p-4 bg-muted/40 border border-border rounded-xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Key size={14} className="text-primary" />
                <span>Quiz Score & Correct Answer Assignment</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-semibold">Points:</span>
                <Input
                  type="number"
                  min="0"
                  value={question.points || 0}
                  onChange={(e) => onUpdate({ ...question, points: parseInt(e.target.value) || 0 })}
                  className="w-16 h-7 text-xs bg-background"
                />
              </div>
            </div>
          </div>
        )}

        {/* Input Simulation Area */}
        <div className="bg-muted/30 border border-border border-dashed rounded-xl p-4">
          {question.type === 'SHORT_TEXT' && (
            <Input disabled placeholder={question.placeholder || 'Short text answer...'} className="bg-background max-w-md" />
          )}

          {question.type === 'LONG_TEXT' && (
            <textarea
              disabled
              placeholder={question.placeholder || 'Long paragraph text answer...'}
              className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm min-h-[80px]"
            />
          )}

          {question.type === 'EMAIL' && (
            <div className="relative max-w-md">
              <Input disabled placeholder="user@acme.com" className="bg-background" />
            </div>
          )}

          {question.type === 'NUMBER' && (
            <Input type="number" disabled placeholder="e.g. 100" className="bg-background max-w-md" />
          )}
          
          {question.type === 'URL' && (
            <Input disabled placeholder="https://" className="bg-background max-w-md" />
          )}
          
          {question.type === 'PHONE' && (
            <Input disabled placeholder="+1 (555) 000-0000" className="bg-background max-w-md" />
          )}

          {question.type === 'DATE' && (
            <div className="flex items-center gap-2 max-w-md border border-input bg-background rounded-md px-3 py-2 text-sm text-muted-foreground">
              <Calendar size={14} />
              <span>MM/DD/YYYY</span>
            </div>
          )}

          {question.type === 'FILE_UPLOAD' && (
            <div className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-lg bg-background p-6 max-w-md">
              <UploadCloud size={24} className="text-muted-foreground mb-2" />
              <span className="text-xs font-semibold text-foreground">Drag and drop file here</span>
              <span className="text-[10px] text-muted-foreground">JPG, PNG, PDF up to 10MB</span>
            </div>
          )}

          {question.type === 'SIGNATURE' && (
            <div className="border border-input rounded-md bg-background h-24 max-w-md flex items-center justify-center text-muted-foreground">
              <PenTool size={16} className="mr-2 opacity-50" />
              <span className="text-xs">Draw Signature Here</span>
            </div>
          )}

          {question.type === 'STAR_RATING' && (
            <div className="flex items-center gap-1 text-muted-foreground">
              {[1,2,3,4,5].map(s => <Star key={s} size={24} />)}
            </div>
          )}

          {question.type === 'NPS' && (
            <div className="flex gap-1 max-w-md w-full justify-between">
              {[0,1,2,3,4,5,6,7,8,9,10].map(n => (
                <div key={n} className="w-8 h-8 rounded-md border border-input bg-background flex items-center justify-center text-xs font-semibold text-muted-foreground">{n}</div>
              ))}
            </div>
          )}

          {['SINGLE_CHOICE', 'MULTI_CHOICE', 'DROPDOWN'].includes(question.type) && (
            <div className="space-y-2 max-w-md">
              {question.options?.map((opt) => (
                <div key={opt.id} className="flex items-center gap-2 group">
                  {isAnswerKeyOpen ? (
                    <button
                      onClick={() => handleToggleCorrectOption(opt.id)}
                      className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border transition-colors ${
                        opt.isCorrect ? 'bg-primary border-primary text-primary-foreground' : 'bg-background border-input text-transparent hover:border-primary'
                      }`}
                    >
                      <Check size={12} />
                    </button>
                  ) : (
                    <div className={`w-4 h-4 shrink-0 border border-input bg-background ${question.type === 'SINGLE_CHOICE' ? 'rounded-full' : 'rounded-sm'}`} />
                  )}
                  
                  <Input
                    type="text"
                    value={opt.label}
                    onChange={(e) => handleOptionChange(opt.id, e.target.value)}
                    className="h-8 text-sm bg-background border-transparent hover:border-input focus-visible:border-input shadow-none"
                  />

                  {isAnswerKeyOpen && opt.isCorrect && (
                    <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">Correct</span>
                  )}
                  
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveOption(opt.id)}
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  >
                    <X size={14} />
                  </Button>
                </div>
              ))}
              
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAddOption}
                className="mt-2 text-primary hover:bg-primary/5 hover:text-primary gap-1"
              >
                <Plus size={14} />
                Add Option
              </Button>
            </div>
          )}

          {question.type === 'SECTION_HEADER' && (
            <div className="py-2">
              <Input
                value={question.placeholder || ''}
                onChange={(e) => onUpdate({ ...question, placeholder: e.target.value })}
                placeholder="Section Subtitle or Description..."
                className="border-0 bg-transparent text-sm text-muted-foreground focus-visible:ring-0 focus-visible:border-b px-0 shadow-none w-full rounded-none"
              />
            </div>
          )}
        </div>

        {/* Conditional Logic Drawer (Visible only if selected and has rules or button clicked) */}
        {isSelected && (
          <div className="pt-2">
            <div className="bg-muted/50 rounded-xl p-3 border border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold text-foreground">Visibility Logic</span>
                <Button variant="outline" size="sm" onClick={addConditionRule} className="h-7 text-xs bg-background">
                  + Add Rule
                </Button>
              </div>

              {logicRules.length === 0 ? (
                <div className="text-[11px] text-muted-foreground text-center py-2">
                  No logic applied. Field is always visible.
                </div>
              ) : (
                <div className="space-y-2">
                  {logicRules.map((rule, idx) => (
                    <div key={rule.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-background p-2 rounded-lg border border-border text-xs">
                      <span className="font-semibold text-muted-foreground shrink-0">{idx === 0 ? 'IF' : 'AND'}</span>
                      <select className="bg-muted border border-border rounded px-2 py-1 flex-1 min-w-[100px] text-foreground text-xs focus:ring-1 focus:ring-ring">
                        <option>Q1: Department</option>
                        <option>Q2: Role</option>
                      </select>
                      <select className="bg-muted border border-border rounded px-2 py-1 w-24 shrink-0 text-foreground text-xs focus:ring-1 focus:ring-ring">
                        <option>Equals</option>
                        <option>Not Equals</option>
                      </select>
                      <Input type="text" placeholder="Value" className="h-7 text-xs bg-background w-24 shrink-0" />
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeConditionRule(rule.id)}>
                        <X size={12} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Hover action block to insert field in between */}
      {isSelected && onAddInlineQuestion && (
        <div className="flex justify-center -my-2 relative z-10 opacity-0 hover:opacity-100 transition-opacity pb-2">
          <Button
            size="sm"
            onClick={() => onAddInlineQuestion('SHORT_TEXT', index)}
            className="rounded-full shadow-md gap-1 h-7 text-xs"
          >
            <Plus size={12} /> Add Field Below
          </Button>
        </div>
      )}
    </div>
  );
}
