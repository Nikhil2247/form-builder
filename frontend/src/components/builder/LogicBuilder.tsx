'use client';

import React from 'react';
import { FormConfig, LogicRule, LogicOperator, LogicAction } from '@/types/form';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { generateId } from '@/lib/utils';
import { GitBranch, Plus, Trash2, ArrowRight, Sparkles } from 'lucide-react';

interface LogicBuilderProps {
  form: FormConfig;
  setForm: React.Dispatch<React.SetStateAction<FormConfig>>;
}

export function LogicBuilder({ form, setForm }: LogicBuilderProps) {
  const handleAddRule = () => {
    if (form.questions.length < 2) return;
    const newRule: LogicRule = {
      id: generateId('logic'),
      triggerQuestionId: form.questions[0].id,
      operator: 'EQUALS',
      value: '',
      action: 'SHOW',
      targetQuestionId: form.questions[1].id
    };
    setForm((prev) => ({ ...prev, logic: [...prev.logic, newRule] }));
  };

  const handleUpdateRule = (updated: LogicRule) => {
    setForm((prev) => ({
      ...prev,
      logic: prev.logic.map((r) => (r.id === updated.id ? updated : r))
    }));
  };

  const handleDeleteRule = (id: string) => {
    setForm((prev) => ({
      ...prev,
      logic: prev.logic.filter((r) => r.id !== id)
    }));
  };

  const operators: Array<{ label: string; value: LogicOperator }> = [
    { label: 'Equals (=)', value: 'EQUALS' },
    { label: 'Does Not Equal (≠)', value: 'NOT_EQUALS' },
    { label: 'Contains', value: 'CONTAINS' },
    { label: 'Is Greater Than (>)', value: 'GREATER_THAN' },
    { label: 'Is Less Than (<)', value: 'LESS_THAN' }
  ];

  const actions: Array<{ label: string; value: LogicAction }> = [
    { label: 'SHOW Field', value: 'SHOW' },
    { label: 'HIDE Field', value: 'HIDE' }
  ];

  return (
    <div className="w-full space-y-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Header */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-400">
                <GitBranch className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  Conditional Logic & Branching Engine
                </h2>
                <p className="text-xs text-slate-500">
                  Configure dynamic show/hide rules based on previous question answers.
                </p>
              </div>
            </div>
            <Button
              onClick={handleAddRule}
              disabled={form.questions.length < 2}
              className="gap-2"
            >
              <Plus className="h-4 w-4" /> Add Logic Rule
            </Button>
          </div>
        </div>

        {/* Rules List */}
        {form.logic.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 p-12 text-center dark:border-slate-800">
            <Sparkles className="h-10 w-10 text-slate-300 dark:text-slate-700 mb-2" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">No Logic Rules Configured</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-md">
              Create conditional rules to dynamically hide or show questions depending on respondent answers (e.g. if Rating &lt; 7, show Detractor Reason box).
            </p>
            {form.questions.length < 2 ? (
              <p className="mt-3 text-xs font-semibold text-rose-500">
                Add at least 2 questions to your form canvas to enable branching rules.
              </p>
            ) : (
              <Button onClick={handleAddRule} variant="outline" className="mt-4 gap-2">
                <Plus className="h-4 w-4" /> Create First Rule
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {form.logic.map((rule, idx) => {
              const triggerQ = form.questions.find((q) => q.id === rule.triggerQuestionId);
              return (
                <div
                  key={rule.id}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      Rule #{idx + 1}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteRule(rule.id)}
                      className="h-7 w-7 text-rose-500 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Rule Builder Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-center text-xs">
                    {/* Trigger Question Selector */}
                    <div className="md:col-span-2 space-y-1">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">IF Question</label>
                      <select
                        value={rule.triggerQuestionId}
                        onChange={(e) => handleUpdateRule({ ...rule, triggerQuestionId: e.target.value })}
                        className="w-full h-9 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {form.questions.map((q) => (
                          <option key={q.id} value={q.id}>
                            {q.label} ({q.type})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Operator */}
                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">Condition</label>
                      <select
                        value={rule.operator}
                        onChange={(e) => handleUpdateRule({ ...rule, operator: e.target.value as LogicOperator })}
                        className="w-full h-9 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      >
                        {operators.map((op) => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Compare Value */}
                    <div className="md:col-span-2 space-y-1">
                      <label className="font-semibold text-slate-700 dark:text-slate-300">Target Value</label>
                      {triggerQ?.options && triggerQ.options.length > 0 ? (
                        <select
                          value={rule.value}
                          onChange={(e) => handleUpdateRule({ ...rule, value: e.target.value })}
                          className="w-full h-9 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        >
                          <option value="">Select option...</option>
                          {triggerQ.options.map((opt) => (
                            <option key={opt.id} value={opt.label}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={rule.value}
                          onChange={(e) => handleUpdateRule({ ...rule, value: e.target.value })}
                          placeholder="e.g. 7, Yes, Email..."
                          className="w-full h-9 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <ArrowRight className="h-4 w-4 text-indigo-500" />
                    <span className="font-semibold text-slate-700 dark:text-slate-300 text-xs">THEN</span>

                    <select
                      value={rule.action}
                      onChange={(e) => handleUpdateRule({ ...rule, action: e.target.value as LogicAction })}
                      className="h-8 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      {actions.map((act) => (
                        <option key={act.value} value={act.value}>
                          {act.label}
                        </option>
                      ))}
                    </select>

                    <span className="text-xs text-slate-500">Target Question:</span>

                    <select
                      value={rule.targetQuestionId || ''}
                      onChange={(e) => handleUpdateRule({ ...rule, targetQuestionId: e.target.value })}
                      className="h-8 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:ring-2 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      <option value="">Select target question...</option>
                      {form.questions.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
