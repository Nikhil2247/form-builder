/**
 * Caps a tool result's size before it enters the model's context — see
 * AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.4. `query_submissions` period
 * breakdowns are the realistic offender; nothing else in ORG_TOOLS/
 * PLATFORM_TOOLS normally gets close to this.
 *
 * Character-based, not token-based — a Claude tokenizer isn't available
 * offline, and this only needs to be a generous ceiling, not a precise one.
 */
const MAX_TOOL_RESULT_CHARS = 3200;

export function capToolResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n\n[truncated — showing the first ~${MAX_TOOL_RESULT_CHARS} characters of a longer result. Ask for a narrower range or a summary instead of the full detail.]`;
}
