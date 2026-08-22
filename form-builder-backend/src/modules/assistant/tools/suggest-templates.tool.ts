import type Anthropic from '@anthropic-ai/sdk';
import type { PrismaService } from '../../../common/infra/prisma/prisma.service';

export const SUGGEST_TEMPLATES_TOOL: Anthropic.Tool = {
  name: 'suggest_templates',
  description:
    'Suggest existing form templates that match a described use case, ranked by relevance. Use this before proposing a brand-new form when the description sounds like a common form type (a survey, a feedback form, a registration form) — starting from a matching template is often faster than generating from scratch.',
  input_schema: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'What the user wants a form for, in their own words.',
      },
    },
    required: ['description'],
  },
};

interface SuggestTemplatesInput {
  description?: unknown;
}

/**
 * FormTemplate has no organizationId — templates are platform-global, not
 * org-scoped (confirmed from schema.prisma), so this needs no tenant filter.
 *
 * Ranking is keyword overlap over name/description/category (the same three
 * fields TemplatesService's own text search already checks) plus a usageCount
 * tiebreak — no embeddings/pgvector wired yet (see
 * AI_ASSISTANT_IMPROVEMENT_PLAN.md §7 on when that changes). Fine at the
 * current template-catalog size.
 */
export async function suggestTemplates(
  prisma: PrismaService,
  rawInput: SuggestTemplatesInput,
  limit = 3,
): Promise<string> {
  const description =
    typeof rawInput.description === 'string' ? rawInput.description : '';
  const terms = tokenize(description);

  const templates = await prisma.reader.formTemplate.findMany({
    where: { isPublic: true },
    select: {
      id: true,
      name: true,
      description: true,
      category: true,
      usageCount: true,
    },
  });

  if (templates.length === 0) return 'No templates are available.';

  const scored = templates.map((template) => {
    const haystack = tokenize(
      `${template.name} ${template.description ?? ''} ${template.category}`,
    );
    const haystackSet = new Set(haystack);
    let score = terms.filter((term) => haystackSet.has(term)).length;
    // A small, bounded nudge from popularity — never enough for an irrelevant
    // but heavily-used template to outrank a genuine keyword match.
    score += Math.log10(template.usageCount + 1) * 0.5;
    return { template, score };
  });

  const ranked = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ template }) => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      usageCount: template.usageCount,
    }));

  return JSON.stringify(ranked);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 2);
}
