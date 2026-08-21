import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * cross_org_query deliberately bypasses the tenant boundary every other tool
 * in this module respects (see cross-org-query.tool.ts's doc comment and
 * AI_ASSISTANT_PLAN.md §5/§10 Phase 4). The one thing standing between that
 * and an org-scoped bot accidentally gaining cross-tenant read access is that
 * it must never be imported into an org-scoped service's tool list.
 *
 * Source-scanned rather than instantiated: these services take Prisma/Redis/
 * Anthropic dependencies that would need a full Nest testing module just to
 * construct, for a check that is really about which files import which —
 * the same reasoning tenant-isolation.spec.ts uses for its file-scan checks.
 */
describe('platform insights — cross-org tool isolation', () => {
  const ASSISTANT_DIR = __dirname;

  const ORG_SCOPED_SERVICES = [
    'idea.service.ts',
    'assistant-chat.service.ts',
    'org-chat.ts',
    'agent-loop.service.ts',
  ];

  function read(file: string): string {
    return readFileSync(join(ASSISTANT_DIR, file), 'utf8');
  }

  it.each(ORG_SCOPED_SERVICES)(
    '%s never imports the cross-org query tool',
    (file) => {
      const source = read(file);
      expect(source).not.toMatch(/cross-org-query\.tool/);
      expect(source).not.toContain('CROSS_ORG_QUERY_TOOL');
      expect(source).not.toContain('cross_org_query');
    },
  );

  it("assistant.controller.ts's org-scoped tool wiring excludes cross_org_query", () => {
    const source = read('assistant.controller.ts');
    expect(source).not.toMatch(/cross-org-query\.tool/);
    expect(source).not.toContain('CROSS_ORG_QUERY_TOOL');
  });

  it('the cross-org query tool is wired only into platform-insights.service.ts', () => {
    const source = read('platform-insights.service.ts');
    expect(source).toContain('CROSS_ORG_QUERY_TOOL');
    expect(source).toMatch(/cross-org-query\.tool/);
  });

  it('platform-assistant.controller.ts has no OrgMemberGuard/RoleGuard in its chain', () => {
    const source = read('platform-assistant.controller.ts');
    const guardsLine = source.match(/@UseGuards\(([^)]*)\)/)?.[1] ?? '';
    expect(guardsLine).not.toContain('OrgMemberGuard');
    expect(guardsLine).not.toContain('RoleGuard');
    expect(guardsLine).toContain('SuperAdminGuard');
  });
});
