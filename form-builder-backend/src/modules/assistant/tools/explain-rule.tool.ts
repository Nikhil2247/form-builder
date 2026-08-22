import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaService } from '../../../common/infra/prisma/prisma.service';
import {
  buildKeyMaps,
  isLiteral,
  isField,
  isRef,
  isOp,
  type FormRule,
  type ExprNode,
  type AdapterQuestion,
} from '../../../common/rules';
import type { LegacyLogicRule } from '../../../common/legacy-logic';

export const EXPLAIN_RULE_TOOL: Anthropic.Tool = {
  name: 'explain_rule',
  description:
    "Explain, in plain language, every calculation, validation, requirement, and show/hide rule currently configured on a specific form (its current draft, not an old published snapshot). Use this whenever the user asks what a rule does, why a question is required or hidden, or wants their form's logic summarized — never guess at a form's rules from the conversation alone.",
  input_schema: {
    type: 'object',
    properties: {
      formId: {
        type: 'string',
        description:
          'The id of the form to explain. Use the form the user is currently working on if one was given as context.',
      },
    },
    required: ['formId'],
  },
};

interface QuestionLike extends AdapterQuestion {
  label?: string;
}

/**
 * Explains a form's *current draft* rules and logic — Form.rulesJson /
 * Form.logicJson, not FormVersion.compiledRules. A builder asking "what does
 * this do" almost always means what they're looking at right now, which can
 * differ from the last published version if there are unsaved edits. This is
 * pure DB read + AST walk — no LLM call, so it costs nothing beyond the tool
 * round trip in the enclosing chat turn.
 */
export async function explainRule(
  prisma: PrismaService,
  orgId: string,
  formId: string,
): Promise<string> {
  const form = await prisma.reader.form.findFirst({
    where: { id: formId, organizationId: orgId, deletedAt: null },
    select: {
      title: true,
      questionsJson: true,
      logicJson: true,
      rulesJson: true,
    },
  });

  if (!form) {
    return `No form with id "${formId}" was found in this organization.`;
  }

  const questions = asArray<QuestionLike>(form.questionsJson);
  const { idByKey } = buildKeyMaps(questions);
  const labelById = new Map<string, string>();
  for (const q of questions) {
    if (q?.id) labelById.set(q.id, q.label ?? q.id);
  }
  const labelByKey = (key: string): string => {
    // A rule addresses a key; resolve key -> id -> label, falling back to the
    // raw key itself for a rule that outlived the question it targeted.
    const id = idByKey.get(key);
    return labelById.get(id ?? key) ?? key;
  };

  const lines: string[] = [`Rules on "${form.title}":`, ''];

  const rules = asArray<FormRule>(form.rulesJson);
  if (rules.length === 0) {
    lines.push(
      'No calculation, validation, requirement, or show rules are configured.',
    );
  } else {
    for (const rule of rules) {
      lines.push(describeRule(rule, labelByKey));
    }
  }

  const legacy = asArray<LegacyLogicRule>(form.logicJson);
  if (legacy.length > 0) {
    lines.push(
      '',
      'Legacy show/hide/jump logic (the older conditional system):',
    );
    for (const rule of legacy) {
      lines.push(describeLegacyRule(rule, labelById));
    }
  }

  return lines.join('\n');
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Exported for reuse by propose-rule.tool.ts, which explains its own proposal the same way. */
export function describeRule(
  rule: FormRule,
  labelByKey: (key: string) => string,
): string {
  const targetLabel = labelByKey(rule.target);
  const exprText = describeExpr(rule.expr, labelByKey);
  switch (rule.kind) {
    case 'CALCULATE':
      return `- "${targetLabel}" is automatically calculated as: ${exprText}.`;
    case 'SHOW':
      return `- "${targetLabel}" is shown only when: ${exprText}.`;
    case 'REQUIRE':
      return `- "${targetLabel}" becomes required when: ${exprText}.`;
    case 'VALIDATE':
      return `- "${targetLabel}" must satisfy: ${exprText}${
        rule.message
          ? ` (shown to the respondent as: "${rule.message}")`
          : ' (no error message is set — add one, or the respondent sees a generic error)'
      }.`;
    default:
      return `- Rule on "${targetLabel}": ${exprText}.`;
  }
}

function describeExpr(
  node: ExprNode,
  labelByKey: (key: string) => string,
): string {
  if (isLiteral(node)) return JSON.stringify(node.lit);
  if (isField(node)) return `"${labelByKey(node.field)}"`;
  if (isRef(node)) {
    return `the ${node.ref.when.toLowerCase()} answer to "${node.ref.question}" on a related form`;
  }
  if (isOp(node)) {
    return `${node.op}(${node.args.map((arg) => describeExpr(arg, labelByKey)).join(', ')})`;
  }
  return 'an expression';
}

const LEGACY_OPERATOR_TEXT: Record<LegacyLogicRule['operator'], string> = {
  EQUALS: 'equals',
  NOT_EQUALS: 'does not equal',
  CONTAINS: 'contains',
  GREATER_THAN: 'is greater than',
  LESS_THAN: 'is less than',
  IS_FILLED: 'is filled in',
};

function describeLegacyRule(
  rule: LegacyLogicRule,
  labelById: Map<string, string>,
): string {
  const trigger =
    labelById.get(rule.triggerQuestionId) ?? rule.triggerQuestionId;
  const opText = LEGACY_OPERATOR_TEXT[rule.operator] ?? rule.operator;
  const condition =
    rule.operator === 'IS_FILLED'
      ? `"${trigger}" ${opText}`
      : `"${trigger}" ${opText} "${rule.value}"`;

  if (rule.action === 'JUMP_TO_PAGE') {
    return `- When ${condition}, skip to page ${rule.targetPageNumber}.`;
  }

  const target = rule.targetQuestionId
    ? (labelById.get(rule.targetQuestionId) ?? rule.targetQuestionId)
    : 'an unspecified question';
  return `- When ${condition}, ${rule.action === 'SHOW' ? 'show' : 'hide'} "${target}".`;
}
