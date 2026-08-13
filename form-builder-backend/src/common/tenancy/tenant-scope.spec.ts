import { Prisma } from '@prisma/client';
import {
  constrains,
  findTenantMismatch,
  ORG_SCOPED_MODELS,
} from './tenant-scope.extension';
import {
  getTenant,
  getTenantId,
  isUnscoped,
  runUnscoped,
  runWithTenant,
} from './tenant-context';

/**
 * Tests for the tenant-scoping mechanism.
 *
 * No database. Two things are worth testing here and they are different in kind:
 *
 *  1. `constrains()` — a pure predicate over Prisma `where` shapes. Ordinary
 *     unit tests, including the cases where it is deliberately lenient, so that
 *     the leniency is recorded rather than discovered later by someone who
 *     assumed it was airtight.
 *
 *  2. The model list — checked against Prisma's own DMMF. This is the test that
 *     earns its keep: `ORG_SCOPED_MODELS` is a hand-maintained list, and the
 *     failure mode of a hand-maintained list is that someone adds an org-scoped
 *     model and forgets it. Deriving the truth from the schema and asserting the
 *     two agree turns that silent gap into a red build.
 */

describe('constrains()', () => {
  it('finds a field at the top level', () => {
    expect(constrains({ organizationId: 'org-1' }, 'organizationId')).toBe(
      true,
    );
  });

  it('rejects a where clause that filters on something else entirely', () => {
    expect(
      constrains({ status: 'PUBLISHED', deletedAt: null }, 'organizationId'),
    ).toBe(false);
  });

  it('rejects an empty or absent where clause', () => {
    expect(constrains(undefined, 'organizationId')).toBe(false);
    expect(constrains({}, 'organizationId')).toBe(false);
    expect(constrains(null, 'organizationId')).toBe(false);
  });

  it('treats an explicit undefined value as absent', () => {
    // `{ organizationId: undefined }` is what you get from `{ organizationId: maybeOrgId }`
    // when the variable is undefined. Prisma ignores the key entirely, so the
    // query is NOT scoped — and this is the single most likely way a real
    // violation reaches production, because the code reads as if it scopes.
    expect(constrains({ organizationId: undefined }, 'organizationId')).toBe(
      false,
    );
  });

  it('finds a field nested inside AND', () => {
    expect(
      constrains(
        { AND: [{ status: 'PUBLISHED' }, { organizationId: 'org-1' }] },
        'organizationId',
      ),
    ).toBe(true);
  });

  it('finds a field nested inside NOT', () => {
    expect(
      constrains({ NOT: { organizationId: 'org-1' } }, 'organizationId'),
    ).toBe(true);
  });

  it('recurses through deeply nested boolean structure', () => {
    expect(
      constrains(
        { AND: [{ OR: [{ AND: [{ organizationId: 'org-1' }] }] }] },
        'organizationId',
      ),
    ).toBe(true);
  });

  it('accepts a relational filter object as a constraint', () => {
    // `{ organizationId: { in: [...] } }` is still a constraint on the column.
    expect(
      constrains({ organizationId: { in: ['a', 'b'] } }, 'organizationId'),
    ).toBe(true);
  });

  describe('known leniency — documented, not accidental', () => {
    it('accepts an OR where only one branch is scoped', () => {
      // This query is NOT in fact tenant-scoped: rows matching the second branch
      // are returned regardless of organization. `constrains` returns true
      // anyway, because deciding it properly needs real boolean analysis.
      //
      // Asserted here so the limitation is a recorded decision. If someone later
      // tightens `constrains`, this test failing is the prompt to confirm the
      // stricter behaviour is intended rather than a regression.
      expect(
        constrains(
          { OR: [{ organizationId: 'org-1' }, { id: 'form-9' }] },
          'organizationId',
        ),
      ).toBe(true);
    });
  });
});

describe('findTenantMismatch()', () => {
  it('passes a create that writes the current tenant', () => {
    expect(
      findTenantMismatch({ organizationId: 'org-1', name: 'x' }, 'org-1'),
    ).toBeNull();
  });

  it('catches a create that writes a different tenant', () => {
    expect(findTenantMismatch({ organizationId: 'org-2' }, 'org-1')).toBe(
      'org-2',
    );
  });

  it('ignores a create that does not mention the tenant at all', () => {
    // Set via a nested relation connect, or genuinely not org-scoped. Guessing
    // here would produce false positives, which is how a safety check gets
    // switched off.
    expect(findTenantMismatch({ name: 'x' }, 'org-1')).toBeNull();
    expect(
      findTenantMismatch(
        { organization: { connect: { id: 'org-2' } } },
        'org-1',
      ),
    ).toBeNull();
  });

  it('checks every row of a createMany', () => {
    const rows = [
      { organizationId: 'org-1' },
      { organizationId: 'org-1' },
      { organizationId: 'org-9' },
    ];
    expect(findTenantMismatch(rows, 'org-1')).toBe('org-9');
  });

  it('handles absent and non-object data', () => {
    expect(findTenantMismatch(undefined, 'org-1')).toBeNull();
    expect(findTenantMismatch(null, 'org-1')).toBeNull();
    expect(findTenantMismatch('nonsense', 'org-1')).toBeNull();
  });
});

describe('tenant context', () => {
  it('is absent outside any run', () => {
    expect(getTenant()).toBeUndefined();
    expect(getTenantId()).toBeUndefined();
  });

  it('exposes the organization inside a run', () => {
    runWithTenant({ organizationId: 'org-1', userId: 'user-1' }, () => {
      expect(getTenantId()).toBe('org-1');
      expect(getTenant()?.userId).toBe('user-1');
      expect(isUnscoped()).toBe(false);
    });
  });

  it('propagates across await boundaries', async () => {
    await runWithTenant({ organizationId: 'org-1' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      // The whole point of AsyncLocalStorage over a parameter: the value
      // survives an await it was never passed through.
      expect(getTenantId()).toBe('org-1');
    });
  });

  it('does not leak out of the run', () => {
    runWithTenant({ organizationId: 'org-1' }, () => undefined);
    expect(getTenantId()).toBeUndefined();
  });

  describe('runUnscoped', () => {
    it('lifts enforcement but preserves attribution', () => {
      runWithTenant({ organizationId: 'org-1', userId: 'user-1' }, () => {
        runUnscoped('super-admin cross-tenant report', () => {
          expect(isUnscoped()).toBe(true);
          // Identity must survive, or the audit log of a cross-tenant read
          // cannot say who performed it — which is when you most want to know.
          expect(getTenant()?.userId).toBe('user-1');
          expect(getTenant()?.unscopedReason).toBe(
            'super-admin cross-tenant report',
          );
        });
      });
    });

    it('restores the surrounding scope on exit', () => {
      runWithTenant({ organizationId: 'org-1' }, () => {
        runUnscoped('reason', () => undefined);
        // The hole is lexical. Nesting must not leave enforcement disabled for
        // the remainder of the request.
        expect(isUnscoped()).toBe(false);
        expect(getTenantId()).toBe('org-1');
      });
    });
  });
});

describe('ORG_SCOPED_MODELS matches the Prisma schema', () => {
  /** Every model in the schema carrying a scalar `organizationId` field. */
  const modelsWithOrgIdColumn = Prisma.dmmf.datamodel.models
    .filter((model) =>
      model.fields.some(
        (field) => field.name === 'organizationId' && field.kind === 'scalar',
      ),
    )
    .map((model) => model.name)
    .sort();

  it('finds org-scoped models in the DMMF at all', () => {
    // Guards against this whole block passing vacuously because the DMMF shape
    // changed in a Prisma upgrade and the filter now matches nothing.
    expect(modelsWithOrgIdColumn.length).toBeGreaterThan(5);
  });

  it('guards every model that has an organizationId column', () => {
    const unguarded = modelsWithOrgIdColumn.filter(
      (name) => !ORG_SCOPED_MODELS.has(name),
    );

    // If this fails you have added an org-scoped model without adding it to
    // ORG_SCOPED_MODELS, and queries against it are not being checked.
    expect(unguarded).toEqual([]);
  });

  it('does not name models that no longer have one', () => {
    const stale = [...ORG_SCOPED_MODELS].filter(
      (name) => !modelsWithOrgIdColumn.includes(name),
    );

    // A stale entry is harmless at runtime but means the list has drifted from
    // the schema, which is how the list stops being trusted.
    expect(stale).toEqual([]);
  });
});
