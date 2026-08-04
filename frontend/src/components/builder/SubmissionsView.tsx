'use client';

import React, { useState } from 'react';
import { FormConfig, FormSubmission } from '@/types/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { generateAndDownloadExcel } from '@/lib/excelExport';
import {
  FileSpreadsheet,
  Search,
  Clock,
  Gauge,
  Layers,
  Eye,
  X,
  Sparkles,
  BarChart2
} from 'lucide-react';

interface SubmissionsViewProps {
  form: FormConfig;
  submissions: FormSubmission[];
}

export function SubmissionsView({ form, submissions }: SubmissionsViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSubmission, setSelectedSubmission] = useState<FormSubmission | null>(null);

  const filteredSubmissions = submissions.filter((sub) => {
    const jsonStr = JSON.stringify(sub).toLowerCase();
    return jsonStr.includes(searchTerm.toLowerCase());
  });

  const totalCount = submissions.length;
  const avgTime = totalCount > 0
    ? (submissions.reduce((acc, curr) => acc + (curr.completionTimeMs ? curr.completionTimeMs / 1000 : 0), 0) / totalCount).toFixed(0)
    : 0;

  const npsList = submissions
    .map((s) => s.answers['q-recommend'])
    .filter((val) => typeof val === 'number') as number[];
  const avgNps = npsList.length > 0
    ? (npsList.reduce((a, b) => a + b, 0) / npsList.length).toFixed(1)
    : 'N/A';

  return (
    <div className="w-full space-y-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header & Excel Export Action */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <BarChart2 className="h-6 w-6 text-indigo-600" />
                Response Submissions & Analytics
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                View submitted data, filter responses, and export styled multi-sheet Excel files.
              </p>
            </div>

            <Button
              onClick={() => generateAndDownloadExcel(form, submissions)}
              variant="default"
              className="gap-2 shadow-md shadow-emerald-500/10 font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <FileSpreadsheet className="h-5 w-5" /> Export Excel (.xlsx)
            </Button>
          </div>

          {/* Stats Bar */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
              <span className="text-xs font-semibold text-slate-500">Total Responses</span>
              <div className="mt-1 text-2xl font-black text-slate-900 dark:text-white">{totalCount}</div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
              <span className="text-xs font-semibold text-slate-500">Avg Completion Time</span>
              <div className="mt-1 text-2xl font-black text-indigo-600 flex items-center gap-1">
                <Clock className="h-5 w-5" /> {avgTime}s
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
              <span className="text-xs font-semibold text-slate-500">Avg NPS Score</span>
              <div className="mt-1 text-2xl font-black text-amber-500 flex items-center gap-1">
                <Gauge className="h-5 w-5" /> {avgNps} / 10
              </div>
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
              <span className="text-xs font-semibold text-slate-500">Form Questions</span>
              <div className="mt-1 text-2xl font-black text-slate-900 dark:text-white flex items-center gap-1">
                <Layers className="h-5 w-5 text-purple-500" /> {form.questions.length}
              </div>
            </div>
          </div>
        </div>

        {/* Filter Search */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search submissions by respondent name, email, or answer..."
              className="pl-9 bg-white dark:bg-slate-900"
            />
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {filteredSubmissions.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <Sparkles className="mx-auto h-8 w-8 text-slate-300 mb-2" />
              <p className="text-sm font-semibold">No submissions match your search filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                <thead className="border-b border-slate-200 bg-slate-50 font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Submission ID</th>
                    <th className="px-4 py-3">Date & Time</th>
                    <th className="px-4 py-3">Duration</th>
                    {form.questions.slice(0, 3).map((q) => (
                      <th key={q.id} className="px-4 py-3 max-w-[200px] truncate">
                        {q.label}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredSubmissions.map((sub) => (
                    <tr
                      key={sub.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono font-bold text-indigo-600">{sub.id}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {new Date(sub.submittedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-medium">{Math.round((sub.completionTimeMs || 0) / 1000)}s</td>

                      {form.questions.slice(0, 3).map((q) => {
                        const val = sub.answers[q.id];
                        return (
                          <td key={q.id} className="px-4 py-3 max-w-[200px] truncate">
                            {Array.isArray(val)
                              ? val.join(', ')
                              : typeof val === 'object'
                              ? JSON.stringify(val)
                              : val ?? '—'}
                          </td>
                        );
                      })}

                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedSubmission(sub)}
                          className="gap-1 text-xs"
                        >
                          <Eye className="h-3.5 w-3.5" /> View Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Submission Detail ({selectedSubmission.id})
                </h3>
                <p className="text-xs text-slate-500">
                  Submitted at {new Date(selectedSubmission.submittedAt).toLocaleString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelectedSubmission(null)}
                className="h-7 w-7"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4">
              {form.questions.map((q) => {
                const answerVal = selectedSubmission.answers[q.id];
                return (
                  <div key={q.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                      {q.label}
                    </span>
                    <div className="text-xs text-slate-900 dark:text-white font-medium">
                      {answerVal !== undefined && answerVal !== null ? (
                        Array.isArray(answerVal) ? (
                          <div className="flex flex-wrap gap-1">
                            {answerVal.map((item, i) => (
                              <Badge key={i} variant="secondary">
                                {item}
                              </Badge>
                            ))}
                          </div>
                        ) : typeof answerVal === 'object' ? (
                          <pre className="rounded bg-slate-200 p-2 font-mono text-[11px] dark:bg-slate-900">
                            {JSON.stringify(answerVal, null, 2)}
                          </pre>
                        ) : (
                          String(answerVal)
                        )
                      ) : (
                        <span className="text-slate-400 italic">No response provided</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
