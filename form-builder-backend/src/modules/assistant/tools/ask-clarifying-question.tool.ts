import type Anthropic from '@anthropic-ai/sdk';

/**
 * The one way the assistant is allowed to stop and ask instead of guessing —
 * see AI_ASSISTANT_IMPROVEMENT_PLAN.md §3.3(b). Calling this tool ends the
 * loop immediately (see agent-loop.service.ts's special-case for this tool
 * name); it is never dispatched through the generic tool runner because
 * there is nothing to execute — the "result" is the question itself.
 */
export const ASK_CLARIFYING_QUESTION_TOOL: Anthropic.Tool = {
  name: 'ask_clarifying_question',
  description:
    "Ask the user one specific question when you don't have enough to answer or to safely create/change something — which form (if there's more than one and none was named), what a form should collect, or whether something is one-off or recurring. Call this instead of guessing or calling a write tool with an assumption. Ask at most one question at a time, and only when there is no sensible default — if a reasonable default exists, state it instead of asking.",
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'The one specific question to ask, in plain language.',
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        maxItems: 4,
        description:
          "The likely answers, when there is a short, known list (e.g. the org's 3 most recently edited forms). Omit for a free-text question.",
      },
      why: {
        type: 'string',
        description:
          'One short phrase on why this is needed, e.g. "so I know which form to add the rule to".',
      },
    },
    required: ['question', 'why'],
  },
};

export interface ClarifyingQuestion {
  question: string;
  options?: string[];
  why: string;
}

export function parseClarifyingQuestion(rawInput: unknown): ClarifyingQuestion {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const options = Array.isArray(input.options)
    ? input.options.filter((o): o is string => typeof o === 'string')
    : undefined;
  return {
    question:
      typeof input.question === 'string'
        ? input.question
        : 'Could you say a bit more about what you need?',
    options: options && options.length > 0 ? options : undefined,
    why: typeof input.why === 'string' ? input.why : '',
  };
}
