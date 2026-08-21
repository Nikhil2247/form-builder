import { Fragment } from 'react';

/**
 * A deliberately small, dependency-free renderer for the assistant's replies
 * — see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.5/§3.6 (Q1): replies used to
 * render inside `whitespace-pre-wrap`, so every bullet and bold the model
 * wrote showed up as literal asterisks and hyphens.
 *
 * Handles exactly what the shared system prompt's answer contract asks the
 * model to produce — short paragraphs, `- ` bullet lists, `**bold**` — and
 * nothing more. No new dependency, and no `dangerouslySetInnerHTML`: every
 * block is built as real React elements, so there is no HTML-injection
 * surface even though the source text ultimately comes from a model.
 */
export function MarkdownLite({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);

  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((block, index) => {
        const lines = block.split('\n').filter((l) => l.trim().length > 0);
        const isList = lines.length > 0 && lines.every((l) => /^[-*]\s+/.test(l.trim()));

        if (isList) {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{renderInline(line.trim().replace(/^[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="whitespace-pre-wrap">
            {renderInline(block)}
          </p>
        );
      })}
    </div>
  );
}

/** Splits on `**bold**` only — the one inline style the answer contract asks for. */
function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}
