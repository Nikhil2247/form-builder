'use client';

import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import { FormConfig, FormQuestion, FormSubmission } from '@/types/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn, generateId } from '@/lib/utils';
import { cardVariantClass } from './FormThemeScope';
import {
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowLeft,
  ArrowRight,
  Star,
  Calendar,
  UploadCloud,
  PenTool,
  Check,
  Award,
  Loader2,
  X as XIcon
} from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { API_BASE_URL } from '@/lib/config';

// Helper component for File Uploads
function FileUploader({ 
  formId, 
  questionId, 
  value, 
  onChange 
}: { 
  formId: string; 
  questionId: string; 
  value: string; 
  onChange: (fileId: string) => void 
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/storage/presigned-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formId,
          questionId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          // Bytes, not megabytes — the API validates an integer byte count and
          // binds it into the S3 signature.
          fileSizeBytes: file.size,
        }),
      });

      if (!res.ok) {
        // Surface the real reason (type not permitted, over the size limit,
        // quota exceeded) instead of a generic failure.
        const body = await res.json().catch(() => null);
        const raw = body?.error?.message ?? body?.message;
        throw new Error(
          (Array.isArray(raw) ? raw.join(', ') : raw) || 'Failed to start upload.',
        );
      }

      const { data } = await res.json();
      
      const uploadRes = await fetch(data.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload file');
      }

      setFileName(file.name);
      onChange(data.fileId);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  if (value) {
    return (
      <div className="flex items-center justify-between border border-border rounded-xl bg-background p-4 max-w-md">
        <div className="flex items-center space-x-3 truncate">
          <CheckCircle2 size={20} className="text-emerald-500" />
          <span className="text-sm font-medium text-foreground truncate">{fileName || 'File Uploaded'}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => { onChange(''); setFileName(''); }}>
          <XIcon size={16} />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-w-md">
      <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl bg-background p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors">
        {isUploading ? (
          <Loader2 size={32} className="mx-auto text-muted-foreground mb-3 animate-spin" />
        ) : (
          <UploadCloud size={32} className="mx-auto text-muted-foreground mb-3" />
        )}
        <div className="text-sm font-semibold text-foreground">
          {isUploading ? 'Uploading...' : 'Click to upload file'}
        </div>
        {!isUploading && <div className="text-xs text-muted-foreground mt-1">or drag and drop</div>}
        <input 
          type="file" 
          className="hidden" 
          onChange={handleFileChange}
          disabled={isUploading}
        />
      </label>
      {error && <p className="text-xs text-destructive mt-1 font-medium">{error}</p>}
    </div>
  );
}

function SignaturePadWrapper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const sigCanvas = React.useRef<any>(null);

  // We only load initial value if provided, but signature canvas doesn't easily support controlled value.
  // We just let the user draw and emit onChange.

  return (
    <div className="space-y-2">
      <div className="border border-border rounded-md bg-white overflow-hidden max-w-[400px]">
        <SignatureCanvas
          ref={sigCanvas}
          penColor="black"
          canvasProps={{ width: 400, height: 200, className: 'sigCanvas w-full h-[200px]' }}
          onEnd={() => {
            if (sigCanvas.current) {
              onChange(sigCanvas.current.toDataURL());
            }
          }}
        />
      </div>
      <Button 
        type="button" 
        variant="outline" 
        size="sm" 
        onClick={() => {
          if (sigCanvas.current) {
            sigCanvas.current.clear();
            onChange('');
          }
        }}
      >
        Clear Signature
      </Button>
    </div>
  );
}

export type RunnerLayoutMode = 'DOCUMENT' | 'CONVERSATIONAL' | 'GRID';

interface FormRunnerProps {
  form: FormConfig;
  onSubmitResponse?: (submission: FormSubmission) => Promise<void> | void;
  onBackToBuilder?: () => void;
  initialAnswers?: Record<string, any>;
  onProgressSave?: (answers: Record<string, any>) => void;
  layoutMode?: RunnerLayoutMode;
  /**
   * The form requires an access password. The runner collects it and hands it
   * back on submit — previously nothing anywhere in the runner asked for one,
   * so a password-protected form rejected every submission with a 403 the
   * respondent had no way to satisfy.
   */
  requiresPassword?: boolean;
  /** Rendered above the questions — cover image, logo, title. */
  header?: React.ReactNode;
}

export function FormRunner({
  form,
  onSubmitResponse,
  onBackToBuilder,
  initialAnswers = {},
  onProgressSave,
  layoutMode = 'DOCUMENT',
  requiresPassword = false,
  header,
}: FormRunnerProps) {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [answers, setAnswers] = useState<Record<string, any>>(initialAnswers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string>('');
  const [formPassword, setFormPassword] = useState<string>('');
  const [quizScore, setQuizScore] = useState<number>(0);
  const [totalMarks, setTotalMarks] = useState<number>(0);
  const [startTime] = useState<number>(Date.now());

  const cardClass = cardVariantClass(form.theme?.cardVariant);
  const isGrid = layoutMode === 'GRID';

  useEffect(() => {
    if (onProgressSave) {
      const timer = setTimeout(() => {
        onProgressSave(answers);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [answers, onProgressSave]);

  const handleInputChange = (questionId: string, value: any) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    if (errors[questionId]) {
      setErrors((prev) => {
        const newErrs = { ...prev };
        delete newErrs[questionId];
        return newErrs;
      });
    }
  };

  const handleMultiChoiceChange = (questionId: string, optionLabel: string, checked: boolean) => {
    setAnswers((prev) => {
      const existing = (prev[questionId] as string[]) || [];
      if (checked) {
        return { ...prev, [questionId]: [...existing, optionLabel] };
      } else {
        return { ...prev, [questionId]: existing.filter(v => v !== optionLabel) };
      }
    });
  };

  const isQuestionVisible = (q: FormQuestion) => {
    const logicRules = form.logic?.filter(l => l.targetQuestionId === q.id);
    if (!logicRules || logicRules.length === 0) return true;

    // If there are SHOW rules, the default is hidden, unless a SHOW condition is met.
    // If there are only HIDE rules, the default is visible, unless a HIDE condition is met.
    const hasShowRules = logicRules.some(r => r.action === 'SHOW');
    let visible = !hasShowRules; 

    for (const rule of logicRules) {
      const triggerAns = answers[rule.triggerQuestionId];
      let conditionMet = false;

      switch (rule.operator) {
        case 'EQUALS':
          conditionMet = triggerAns === rule.value || (Array.isArray(triggerAns) && triggerAns.includes(rule.value));
          break;
        case 'NOT_EQUALS':
          conditionMet = triggerAns !== rule.value && !(Array.isArray(triggerAns) && triggerAns.includes(rule.value));
          break;
        case 'CONTAINS':
          conditionMet = Array.isArray(triggerAns) ? triggerAns.includes(rule.value) : typeof triggerAns === 'string' && triggerAns.includes(rule.value);
          break;
        case 'IS_FILLED':
          conditionMet = triggerAns !== undefined && triggerAns !== null && triggerAns !== '' && (!Array.isArray(triggerAns) || triggerAns.length > 0);
          break;
        case 'GREATER_THAN':
          conditionMet = Number(triggerAns) > Number(rule.value);
          break;
        case 'LESS_THAN':
          conditionMet = Number(triggerAns) < Number(rule.value);
          break;
      }

      if (rule.action === 'SHOW' && conditionMet) visible = true;
      if (rule.action === 'HIDE' && conditionMet) visible = false;
    }
    return visible;
  };

  const getVisibleQuestions = () => {
    return form.questions.filter(q => q.type !== 'SECTION_HEADER' && isQuestionVisible(q));
  };

  const validatePage = (): boolean => {
    let pageQuestions: FormQuestion[] = [];
    if (layoutMode === 'CONVERSATIONAL') {
      const visible = getVisibleQuestions();
      const currentQ = visible[currentPage - 1];
      if (currentQ) pageQuestions = [currentQ];
    } else {
      pageQuestions = form.questions.filter(
        (q) => (q.pageNumber || 1) === currentPage && q.type !== 'SECTION_HEADER' && isQuestionVisible(q)
      );
    }

    const newErrors: Record<string, string> = {};
    pageQuestions.forEach((q) => {
      if (q.validation?.required) {
        const val = answers[q.id];
        if (
          val === undefined ||
          val === null ||
          val === '' ||
          (Array.isArray(val) && val.length === 0)
        ) {
          newErrors[q.id] = 'This question is required.';
        }
      }
    });

    // Checked on the final step only — that is when it is sent, and blocking
    // page 1 on a password field that is not on screen yet is a dead end.
    const lastPage =
      layoutMode === 'CONVERSATIONAL' ? getVisibleQuestions().length : form.pages?.length || 1;
    if (requiresPassword && currentPage >= lastPage && !formPassword.trim()) {
      newErrors._password = 'Enter the access password for this form.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatePage()) return;

    if (layoutMode === 'CONVERSATIONAL') {
      const visible = getVisibleQuestions();
      if (currentPage < visible.length) {
        setCurrentPage(c => c + 1);
        return;
      }
    } else {
      if (currentPage < (form.pages?.length || 1)) {
          setCurrentPage(c => c + 1);
          return;
      }
    }

    let score = 0;
    let maxScore = 0;

    form.questions.forEach((q) => {
      if (q.type === 'SECTION_HEADER') return;
      const pts = q.points || 0;
      maxScore += pts;

      if (pts > 0) {
        const userAns = answers[q.id];
        if (q.type === 'SINGLE_CHOICE' || q.type === 'DROPDOWN') {
          const correctOpt = q.options?.find((o) => o.isCorrect);
          if (correctOpt && userAns === correctOpt.label) score += pts;
        } else if (q.type === 'MULTI_CHOICE') {
          const correctOpts = q.options?.filter((o) => o.isCorrect).map((o) => o.label) || [];
          const userArr = (userAns as string[]) || [];
          if (
            correctOpts.length > 0 &&
            correctOpts.every((item) => userArr.includes(item)) &&
            userArr.every((item) => correctOpts.includes(item))
          ) {
            score += pts;
          }
        }
      }
    });

    setQuizScore(score);
    setTotalMarks(maxScore);

    const completionTimeMs = Date.now() - startTime;
    const newSubmission: FormSubmission = {
      id: generateId('sub'),
      formId: form.id,
      submittedAt: new Date().toISOString(),
      completionTimeMs,
      answers,
      quizScore: maxScore > 0 ? score : undefined,
      maxQuizScore: maxScore > 0 ? maxScore : undefined
    };

    // Carried out-of-band rather than as an answer: it is a gate on the form,
    // not a response to it, and must never be stored with the answers.
    if (requiresPassword) {
      (newSubmission as any).formPassword = formPassword;
    }

    setIsSubmitting(true);
    setSubmitError('');

    try {
      if (onSubmitResponse) {
        await onSubmitResponse(newSubmission);
      }
      setIsSubmitted(true);
      try {
        confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      } catch (err) {}
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to submit form. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalPages = layoutMode === 'CONVERSATIONAL' ? getVisibleQuestions().length : (form.pages?.length || 1);

  if (isSubmitted) {
    return (
      <div className="p-8 text-center space-y-6 max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto shadow-sm">
          <CheckCircle2 size={36} />
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-foreground">{form.title}</h2>
          <p className="text-sm text-muted-foreground">Your response has been recorded successfully.</p>
        </div>

        {totalMarks > 0 && (
          <Card className="bg-primary/5 border-primary/20 p-5 space-y-2">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-primary">
              <Award size={18} />
              <span>Quiz Result</span>
            </div>
            <div className="text-3xl font-black text-primary">
              {quizScore} / {totalMarks} <span className="text-sm font-semibold opacity-80">Points</span>
            </div>
          </Card>
        )}

        <Button
          onClick={() => {
            setIsSubmitted(false);
            setAnswers({});
            setCurrentPage(1);
            if (onBackToBuilder) onBackToBuilder();
          }}
          className="w-full gap-2 mt-4"
        >
          <Check size={16} /> Done
        </Button>
      </div>
    );
  }

  const renderQuestions = layoutMode === 'CONVERSATIONAL'
    ? [getVisibleQuestions()[currentPage - 1]].filter(Boolean)
    : form.questions.filter((q) => (q.pageNumber || 1) === currentPage).filter(isQuestionVisible);

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      {totalPages > 1 && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs font-semibold text-muted-foreground">
            <span>{layoutMode === 'CONVERSATIONAL' ? 'Question' : 'Step'} {currentPage} of {totalPages}</span>
            <span>{Math.round((currentPage / totalPages) * 100)}% Completed</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${(currentPage / totalPages) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Form Header Banner Card (Hide in conversational mode to save space, or show once) */}
      {(layoutMode !== 'CONVERSATIONAL' || currentPage === 1) &&
        (header ?? (
          <Card className={cn('p-6 bg-card space-y-2', cardClass)}>
            <h1 className="text-2xl font-bold text-foreground">{form.title}</h1>
            {form.description && <p className="text-sm text-muted-foreground">{form.description}</p>}
          </Card>
        ))}

      {/* Questions List */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* GRID lays two questions per row on wide screens, honouring each
            question's own `colSpan` — a field the builder has always written
            and nothing has ever read. */}
        <div className={cn(isGrid ? 'grid grid-cols-1 gap-6 md:grid-cols-2' : 'space-y-6')}>
        {renderQuestions.map((q) => {
            if (q.type === 'SECTION_HEADER') {
              return (
                <div
                  key={q.id}
                  className={cn('pt-4 pb-2 border-b border-border space-y-1', isGrid && 'md:col-span-2')}
                >
                  <h3 className="text-lg font-bold text-foreground">{q.label}</h3>
                  {q.description && <p className="text-sm text-muted-foreground">{q.description}</p>}
                </div>
              );
            }

            const errorMsg = errors[q.id];

            return (
              <Card
                key={q.id}
                className={cn(
                  'p-6 bg-card space-y-4',
                  cardClass,
                  isGrid && (q.colSpan ?? 2) === 2 && 'md:col-span-2',
                  errorMsg && 'border-destructive ring-1 ring-destructive',
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <Label className="text-base font-semibold text-foreground leading-snug">
                    {q.label}
                    {q.validation?.required && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  {(q.points || 0) > 0 && (
                    <span className="text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 whitespace-nowrap">
                      {q.points} pts
                    </span>
                  )}
                </div>

                {q.description && <p className="text-sm text-muted-foreground">{q.description}</p>}

                <div className="pt-2">
                  {/* Input Type Renderers */}
                  {['SHORT_TEXT', 'EMAIL', 'PHONE', 'NUMBER', 'URL'].includes(q.type) && (
                    <Input
                      type={q.type === 'NUMBER' ? 'number' : q.type === 'EMAIL' ? 'email' : 'text'}
                      placeholder={q.placeholder || 'Your answer...'}
                      value={answers[q.id] || ''}
                      onChange={(e) => handleInputChange(q.id, e.target.value)}
                      className="bg-background max-w-md"
                    />
                  )}

                  {q.type === 'LONG_TEXT' && (
                    <Textarea
                      placeholder={q.placeholder || 'Your detailed answer...'}
                      value={answers[q.id] || ''}
                      onChange={(e) => handleInputChange(q.id, e.target.value)}
                      rows={4}
                      className="bg-background max-w-2xl"
                    />
                  )}

                  {q.type === 'SINGLE_CHOICE' && (
                    <RadioGroup
                      value={answers[q.id] || ''}
                      onValueChange={(val) => handleInputChange(q.id, val)}
                      className="space-y-3"
                    >
                      {q.options?.map((opt) => (
                        <div key={opt.id} className="flex items-center space-x-3">
                          <RadioGroupItem value={opt.label} id={`r-${q.id}-${opt.id}`} />
                          <Label htmlFor={`r-${q.id}-${opt.id}`} className="font-normal cursor-pointer">{opt.label}</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  )}

                  {q.type === 'MULTI_CHOICE' && (
                    <div className="space-y-3">
                      {q.options?.map((opt) => {
                        const checked = (answers[q.id] || []).includes(opt.label);
                        return (
                          <div key={opt.id} className="flex items-center space-x-3">
                            <Checkbox
                              id={`c-${q.id}-${opt.id}`}
                              checked={checked}
                              onCheckedChange={(c) => handleMultiChoiceChange(q.id, opt.label, c === true)}
                            />
                            <Label htmlFor={`c-${q.id}-${opt.id}`} className="font-normal cursor-pointer">{opt.label}</Label>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {q.type === 'DROPDOWN' && (
                    <select
                      value={answers[q.id] || ''}
                      onChange={(e) => handleInputChange(q.id, e.target.value)}
                      className="w-full max-w-md bg-background border border-input rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    >
                      <option value="">Select an option...</option>
                      {q.options?.map((opt) => (
                        <option key={opt.id} value={opt.label}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {q.type === 'FILE_UPLOAD' && (
                    <FileUploader
                      formId={form.id}
                      questionId={q.id}
                      value={answers[q.id] || ''}
                      onChange={(fileId) => handleInputChange(q.id, fileId)}
                    />
                  )}

                  {q.type === 'DATE' && (
                    <Input
                      type="date"
                      value={answers[q.id] || ''}
                      onChange={(e) => handleInputChange(q.id, e.target.value)}
                      className="bg-background max-w-[200px]"
                    />
                  )}

                  {q.type === 'STAR_RATING' && (
                    <div className="flex gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          type="button"
                          key={star}
                          onClick={() => handleInputChange(q.id, star)}
                          className={`p-1 transition-colors ${
                            (answers[q.id] || 0) >= star
                              ? 'text-yellow-400'
                              : 'text-muted-foreground hover:text-yellow-400/50'
                          }`}
                        >
                          <Star size={32} fill={(answers[q.id] || 0) >= star ? 'currentColor' : 'none'} />
                        </button>
                      ))}
                    </div>
                  )}
                  
                  {q.type === 'NPS' && (
                    <div className="flex flex-wrap gap-2 max-w-2xl w-full justify-between">
                      {[0,1,2,3,4,5,6,7,8,9,10].map(n => {
                        const isSelected = answers[q.id] === n;
                        return (
                          <button
                            type="button"
                            key={n}
                            onClick={() => handleInputChange(q.id, n)}
                            className={`w-10 h-10 rounded-md border text-sm font-semibold transition-all ${
                              isSelected
                                ? 'bg-primary text-primary-foreground border-primary shadow-md transform scale-110'
                                : 'bg-background border-input text-foreground hover:border-primary'
                            }`}
                          >
                            {n}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {q.type === 'SIGNATURE' && (
                    <SignaturePadWrapper 
                      value={answers[q.id] || ''} 
                      onChange={(v) => handleInputChange(q.id, v)} 
                    />
                  )}

                  {q.type === 'REPEATING_SECTION' && (
                    <div className="space-y-4">
                      {((answers[q.id] as any[]) || [{}]).map((row: any, rowIndex: number) => (
                        <div key={rowIndex} className="relative p-4 border border-border rounded-md bg-muted/20">
                          <div className="absolute right-2 top-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive h-8 px-2 text-xs"
                              onClick={() => {
                                const newArr = [...((answers[q.id] as any[]) || [{}])];
                                newArr.splice(rowIndex, 1);
                                handleInputChange(q.id, newArr);
                              }}
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="font-semibold text-xs text-muted-foreground mb-3 uppercase tracking-wider">Item {rowIndex + 1}</div>
                          <div className="grid grid-cols-1 gap-4">
                            {q.subQuestions?.map(subQ => (
                              <div key={subQ.id}>
                                <Label className="text-sm font-medium mb-1 block">{subQ.label}</Label>
                                {['SHORT_TEXT', 'EMAIL', 'NUMBER'].includes(subQ.type) ? (
                                  <Input
                                    type={subQ.type === 'NUMBER' ? 'number' : subQ.type === 'EMAIL' ? 'email' : 'text'}
                                    value={row[subQ.id] || ''}
                                    onChange={(e) => {
                                      const newArr = [...((answers[q.id] as any[]) || [{}])];
                                      newArr[rowIndex] = { ...newArr[rowIndex], [subQ.id]: e.target.value };
                                      handleInputChange(q.id, newArr);
                                    }}
                                  />
                                ) : (
                                  <Input
                                    type="text"
                                    value={row[subQ.id] || ''}
                                    placeholder="Enter value..."
                                    onChange={(e) => {
                                      const newArr = [...((answers[q.id] as any[]) || [{}])];
                                      newArr[rowIndex] = { ...newArr[rowIndex], [subQ.id]: e.target.value };
                                      handleInputChange(q.id, newArr);
                                    }}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const newArr = [...((answers[q.id] as any[]) || [{}])];
                          newArr.push({});
                          handleInputChange(q.id, newArr);
                        }}
                      >
                        + Add Another
                      </Button>
                    </div>
                  )}

                  {q.type === 'MATRIX' && (
                    <div className="w-full overflow-x-auto bg-background rounded-lg border border-border">
                      <table className="w-full text-sm text-left">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border">
                            <th className="p-3 border-r border-border min-w-[150px]"></th>
                            {q.matrixColumns?.map(col => (
                              <th key={col} className="p-3 text-center font-semibold text-muted-foreground whitespace-nowrap">{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {q.matrixRows?.map((row, rIdx) => (
                            <tr key={row} className={`border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors`}>
                              <td className="p-3 border-r border-border font-medium text-foreground bg-muted/10">{row}</td>
                              {q.matrixColumns?.map(col => (
                                <td key={col} className="p-3 text-center" onClick={() => {
                                  const current = answers[q.id] || {};
                                  handleInputChange(q.id, { ...current, [row]: col });
                                }}>
                                  <input 
                                    type="radio" 
                                    name={`matrix-${q.id}-${row}`}
                                    checked={(answers[q.id]?.[row] === col)}
                                    onChange={() => {}} // Handled by td onClick
                                    className="w-4 h-4 text-primary cursor-pointer"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {errorMsg && (
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive mt-2">
                    <AlertCircle size={14} />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* Access password — asked for on the final step only, since that is
            when it is checked. */}
        {requiresPassword && currentPage >= totalPages && (
          <Card className={cn('p-6 bg-card space-y-3', cardClass)}>
            <Label htmlFor="form-access-password" className="text-base font-semibold text-foreground">
              Access password <span className="ml-1 text-destructive">*</span>
            </Label>
            <p className="text-sm text-muted-foreground">
              This form is password protected. Enter the password you were given to submit your
              response.
            </p>
            <Input
              id="form-access-password"
              type="password"
              autoComplete="off"
              value={formPassword}
              onChange={(e) => {
                setFormPassword(e.target.value);
                if (errors._password) {
                  setErrors((prev) => {
                    const next = { ...prev };
                    delete next._password;
                    return next;
                  });
                }
              }}
              placeholder="Enter password"
              aria-invalid={!!errors._password}
              className="bg-background max-w-sm"
            />
            {errors._password && (
              <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
                <AlertCircle size={14} />
                <span>{errors._password}</span>
              </div>
            )}
          </Card>
        )}

        <div className="flex items-center justify-between pt-6 border-t border-border">
          {currentPage > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="gap-2"
              disabled={isSubmitting}
            >
              <ArrowLeft size={16} /> Back
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-4">
            {submitError && (
              <span className="text-sm font-semibold text-destructive">{submitError}</span>
            )}
            <Button type="submit" className="gap-2 font-bold px-8" disabled={isSubmitting}>
              {currentPage < totalPages ? (
                <>Next Step <ArrowRight size={16} /></>
              ) : isSubmitting ? (
                <><Loader2 size={16} className="animate-spin" /> Submitting...</>
              ) : (
                <>Submit Response <Check size={16} /></>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
