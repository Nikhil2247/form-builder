import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ORG_TOOLS } from './tools/org-tools';
import { ORG_SYSTEM_PROMPT } from './system-prompts';

/**
 * Guards the one fact this whole cost design depends on — see
 * AI_ASSISTANT_IMPROVEMENT_PLAN.md §2.1 (C1) and §3.1/§3.9: the shared org
 * prefix (tools + system) must clear Haiku 4.5's cacheable-prefix minimum
 * (4096 tokens), and it must stay byte-identical across every org, user, and
 * turn — no per-request value may leak into it. If either regresses, prompt
 * caching silently goes back to never activating, with no error raised.
 */
describe('assistant prefix caching invariants', () => {
  const ASSISTANT_DIR = __dirname;

  function read(file: string): string {
    return readFileSync(join(ASSISTANT_DIR, file), 'utf8');
  }

  /**
   * Conservative chars/4 floor, not a real tokenizer count — this repo has no
   * offline Claude tokenizer, and a live `messages.count_tokens` call would
   * make a unit test depend on network + a configured API key. Treat this as
   * a regression trip-wire, not a precise measurement: Phase A's actual
   * acceptance check is `cache_read_input_tokens > 0` on a real second turn
   * (see the plan's §5 Phase A acceptance criteria).
   */
  const HAIKU_MIN_CACHEABLE_TOKENS = 4096;
  const CHARS_PER_TOKEN_FLOOR = 4;

  it("the combined tools schema + system prompt clears Haiku 4.5's cacheable minimum", () => {
    const toolsChars = JSON.stringify(ORG_TOOLS).length;
    const systemChars = ORG_SYSTEM_PROMPT.length;
    const estimatedTokens = (toolsChars + systemChars) / CHARS_PER_TOKEN_FLOOR;

    expect(estimatedTokens).toBeGreaterThan(HAIKU_MIN_CACHEABLE_TOKENS);
  });

  it('the help corpus is inlined into the system prompt, not fetched via a tool', () => {
    // A couple of doc titles that should appear verbatim once inlined.
    expect(ORG_SYSTEM_PROMPT).toContain('Building your first form');
    expect(ORG_SYSTEM_PROMPT).toContain('Choosing the right question type');
  });

  it('search_help_docs has been fully retired — no file in this module references it', () => {
    for (const file of listTsFiles(ASSISTANT_DIR)) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/search-help-docs\.tool/);
      expect(source).not.toContain('SEARCH_HELP_DOCS_TOOL');
      expect(source).not.toContain('searchHelpDocs');
    }
  });

  it('org-chat.ts (the single place that builds the request) passes ORG_SYSTEM_PROMPT and ORG_TOOLS verbatim — no per-call fork', () => {
    const source = read('org-chat.ts');
    expect(source).toMatch(/system:\s*ORG_SYSTEM_PROMPT\b/);
    expect(source).toMatch(/tools:\s*ORG_TOOLS\b/);
    // Guards against a future per-user/per-org filter creeping in, e.g.
    // `tools: ORG_TOOLS.filter(...)` — that forks the cached prefix.
    expect(source).not.toMatch(/ORG_TOOLS\s*\.\s*(filter|map|slice)/);
  });

  const ORG_SCOPED_SERVICES = ['assistant-chat.service.ts'];

  it.each(ORG_SCOPED_SERVICES)(
    '%s delegates to the shared runOrgChat rather than building its own request',
    (file) => {
      const source = read(file);
      expect(source).toMatch(/runOrgChat\(/);
      expect(source).not.toContain('ORG_SYSTEM_PROMPT');
      expect(source).not.toContain('ORG_TOOLS');
    },
  );

  it('ORG_SYSTEM_PROMPT is a plain string constant, not a per-call function', () => {
    expect(typeof ORG_SYSTEM_PROMPT).toBe('string');
  });

  it('the platform-wide FAQ cache is only ever written for a turn that called no tool — §6 decision 4', () => {
    const source = read('agent-loop.service.ts');
    const setCallIndex = source.indexOf('this.faqCache.set(');
    const guardIndex = source.indexOf('toolCallLog.length === 0');
    expect(setCallIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(setCallIndex);
  });

  it('the FAQ cache key formula folds in the mode hint, so Help and Insights never share a cached answer', () => {
    const source = read('faq-cache.service.ts');
    expect(source).toMatch(/modeHint/);
  });
});

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}
