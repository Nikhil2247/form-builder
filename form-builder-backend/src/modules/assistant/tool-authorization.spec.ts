import { readFileSync } from 'fs';
import { join } from 'path';
import { ORG_TOOLS, TOOL_MIN_ROLE } from './tools/org-tools';
import { ASK_CLARIFYING_QUESTION_TOOL } from './tools/ask-clarifying-question.tool';
import { PLAN_FORM_TOOL, PLAN_FORM_APP_TOOL } from './tools/plan-form.tool';
import { CREATE_FROM_PLAN_TOOL } from './tools/create-from-plan.tool';
import { PROPOSE_RULE_TOOL } from './tools/propose-rule.tool';
import { REVIEW_FORM_TOOL } from './tools/review-form.tool';
import { SUGGEST_TEMPLATES_TOOL } from './tools/suggest-templates.tool';

/**
 * Guards the security-model change from AI_ASSISTANT_IMPROVEMENT_PLAN.md
 * §3.1/§6.1: the org-scoped assistant route dropped to VIEWER (see
 * assistant.controller.ts), so the pre-existing EDITOR boundary on "build"
 * actions now lives entirely in tools/org-tools.ts#TOOL_MIN_ROLE, enforced by
 * runOrgTool. If a tool is ever added to ORG_TOOLS without a role entry, or a
 * write-capable tool's entry is silently downgraded, this is the test that
 * catches it — there is no other backstop.
 */
describe('assistant tool authorization', () => {
  const ASSISTANT_DIR = __dirname;

  function read(file: string): string {
    return readFileSync(join(ASSISTANT_DIR, file), 'utf8');
  }

  it('every tool in ORG_TOOLS has an explicit TOOL_MIN_ROLE entry — no tool silently defaults', () => {
    for (const tool of ORG_TOOLS) {
      expect(TOOL_MIN_ROLE).toHaveProperty(tool.name);
    }
  });

  it('TOOL_MIN_ROLE has no stale entries for tools no longer in ORG_TOOLS', () => {
    const toolNames = new Set(ORG_TOOLS.map((t) => t.name));
    for (const name of Object.keys(TOOL_MIN_ROLE)) {
      expect(toolNames.has(name)).toBe(true);
    }
  });

  it('read-only tools require no more than VIEWER', () => {
    expect(TOOL_MIN_ROLE[ASK_CLARIFYING_QUESTION_TOOL.name]).toBe('VIEWER');
  });

  const WRITE_CAPABLE_TOOLS = [
    PLAN_FORM_TOOL.name,
    PLAN_FORM_APP_TOOL.name,
    CREATE_FROM_PLAN_TOOL.name,
    PROPOSE_RULE_TOOL.name,
    REVIEW_FORM_TOOL.name,
    SUGGEST_TEMPLATES_TOOL.name,
  ];

  it.each(WRITE_CAPABLE_TOOLS)(
    '%s requires at least EDITOR — the pre-existing build-tool boundary, relocated not widened',
    (name) => {
      expect(['EDITOR', 'ADMIN']).toContain(TOOL_MIN_ROLE[name]);
    },
  );

  it('create_from_plan — the only tool that turns a plan into real rows — requires EDITOR', () => {
    expect(TOOL_MIN_ROLE[CREATE_FROM_PLAN_TOOL.name]).toBe('EDITOR');
  });

  it('runOrgTool checks the role before dispatching to any handler', () => {
    const source = read('tools/org-tools.ts');
    const roleCheckIndex = source.indexOf('roleSatisfies');
    const dispatchCallIndex = source.indexOf('dispatch(deps, name, input)');
    expect(roleCheckIndex).toBeGreaterThan(-1);
    expect(dispatchCallIndex).toBeGreaterThan(-1);
    expect(roleCheckIndex).toBeLessThan(dispatchCallIndex);
  });

  it('the org-scoped route guard is VIEWER, with the EDITOR boundary enforced per-tool instead', () => {
    const source = read('assistant.controller.ts');
    expect(source).toMatch(/@RequiredRole\('VIEWER'\)/);
  });
});
