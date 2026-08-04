import * as XLSX from 'xlsx';
import { FormConfig, FormSubmission } from '@/types/form';

export function generateAndDownloadExcel(form: FormConfig, submissions: FormSubmission[]) {
  const workbook = XLSX.utils.book_new();

  // 1. Build Submissions Sheet Data
  const submissionHeaders = ['Submission ID', 'Submitted Date', 'Completion Time (sec)'];
  form.questions.forEach((q) => {
    submissionHeaders.push(`${q.label} (ID: ${q.id})`);
  });

  const submissionRows: any[][] = [submissionHeaders];

  submissions.forEach((sub) => {
    const row: any[] = [
      sub.id,
      new Date(sub.submittedAt).toLocaleString(),
      Math.round((sub.completionTimeMs || 0) / 1000)
    ];

    form.questions.forEach((q) => {
      const ans = sub.answers[q.id];
      if (ans === undefined || ans === null) {
        row.push('');
      } else if (Array.isArray(ans)) {
        row.push(ans.join(', '));
      } else if (typeof ans === 'object') {
        // Matrix or complex objects
        row.push(JSON.stringify(ans));
      } else {
        row.push(ans);
      }
    });

    submissionRows.push(row);
  });

  const submissionsWorksheet = XLSX.utils.aoa_to_sheet(submissionRows);

  // Set column widths dynamically
  const colWidths = submissionHeaders.map((hdr) => ({
    wch: Math.max(hdr.length + 4, 18)
  }));
  submissionsWorksheet['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(workbook, submissionsWorksheet, 'Submissions');

  // 2. Build Analytics Summary Sheet Data
  const totalSubmissions = submissions.length;
  const avgCompletionTime = totalSubmissions > 0
    ? (submissions.reduce((acc, curr) => acc + (curr.completionTimeMs ? curr.completionTimeMs / 1000 : 0), 0) / totalSubmissions).toFixed(1)
    : 0;

  const npsScores = submissions
    .map((s) => s.answers['q-recommend'])
    .filter((val) => typeof val === 'number') as number[];

  const avgNps = npsScores.length > 0
    ? (npsScores.reduce((a, b) => a + b, 0) / npsScores.length).toFixed(1)
    : 'N/A';

  const analyticsRows: any[][] = [
    ['Metric Key', 'Value'],
    ['Form Title', form.title],
    ['Total Submissions', totalSubmissions],
    ['Average Completion Time (Seconds)', avgCompletionTime],
    ['Average Net Promoter Score (NPS)', avgNps],
    ['Total Questions', form.questions.length],
    ['Total Logic Rules Configured', form.logic.length],
    [],
    ['Question Type Breakdown'],
    ['Question Type', 'Count']
  ];

  const typeCounts: Record<string, number> = {};
  form.questions.forEach((q) => {
    typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;
  });

  Object.entries(typeCounts).forEach(([type, count]) => {
    analyticsRows.push([type, count]);
  });

  const analyticsWorksheet = XLSX.utils.aoa_to_sheet(analyticsRows);
  analyticsWorksheet['!cols'] = [{ wch: 35 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(workbook, analyticsWorksheet, 'Analytics Summary');

  // 3. Build Form Metadata Sheet Data
  const metadataRows = [
    ['Property', 'Details'],
    ['Form ID', form.id],
    ['Form Title', form.title],
    ['Description', form.description || 'N/A'],
    ['Theme Preset', form.theme.preset],
    ['Primary Color Code', form.theme.primaryColor],
    ['Font Family', form.theme.fontFamily],
    ['Card Variant', form.theme.cardVariant],
    ['Export Timestamp', new Date().toISOString()]
  ];

  const metadataWorksheet = XLSX.utils.aoa_to_sheet(metadataRows);
  metadataWorksheet['!cols'] = [{ wch: 25 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(workbook, metadataWorksheet, 'Form Metadata');

  // Trigger Download in browser
  const filename = `${form.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_export.xlsx`;
  XLSX.writeFile(workbook, filename);
}
