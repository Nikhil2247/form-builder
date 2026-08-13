import {
  selectRecipients,
  crossedQuotaThreshold,
  NOTIFICATION_TYPES,
  type OrgMemberRef,
} from './notification-recipients';

/**
 * Fan-out is the part of this feature that leaks data when it is wrong, and it
 * is the only part that can be tested without a database, a Redis, or an open
 * socket — so it is where the cover goes.
 *
 * The cases below are the four ways a notification reaches somebody it should
 * not: a role that cannot read the underlying resource, a member of a different
 * tenant, the person who caused the event, and a type nobody has written a rule
 * for yet.
 */
describe('selectRecipients', () => {
  const ORG = 'org-1';
  const OTHER_ORG = 'org-2';

  const admin: OrgMemberRef = {
    userId: 'u-admin',
    role: 'ADMIN',
    organizationId: ORG,
  };
  const editor: OrgMemberRef = {
    userId: 'u-editor',
    role: 'EDITOR',
    organizationId: ORG,
  };
  const viewer: OrgMemberRef = {
    userId: 'u-viewer',
    role: 'VIEWER',
    organizationId: ORG,
  };
  const roster = [admin, editor, viewer];

  describe('role filtering', () => {
    it('tells every member about a new submission', () => {
      // All three roles hold `submission:view`, so all three are told.
      const recipients = selectRecipients(roster, {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.NEW_SUBMISSION,
      });
      expect(recipients).toEqual(['u-admin', 'u-editor', 'u-viewer']);
    });

    it('tells only admins that a member joined', () => {
      // The body of a member_joined notification names the person who joined.
      // A VIEWER cannot open /team, so they must not be told through the side
      // door either.
      const recipients = selectRecipients(roster, {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.MEMBER_JOINED,
      });
      expect(recipients).toEqual(['u-admin']);
    });

    it('tells only admins about a failed webhook delivery', () => {
      // Webhook routes are @RequiredRole('ADMIN') — an EDITOR cannot see or fix
      // the endpoint, so notifying them would be noise they cannot act on and
      // would disclose the integration's existence.
      const recipients = selectRecipients(roster, {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.WEBHOOK_FAILED,
      });
      expect(recipients).toEqual(['u-admin']);
    });

    it('tells only admins about a quota threshold', () => {
      const recipients = selectRecipients(roster, {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.QUOTA_WARNING,
      });
      expect(recipients).toEqual(['u-admin']);
    });

    it('excludes a role the schema knows but this file does not', () => {
      // Ranks 0, clears no threshold. A role added to the Prisma enum without
      // being added here gets nothing rather than everything.
      const recipients = selectRecipients(
        [{ userId: 'u-new', role: 'BILLING_CONTACT', organizationId: ORG }],
        { organizationId: ORG, type: NOTIFICATION_TYPES.NEW_SUBMISSION },
      );
      expect(recipients).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('drops members belonging to another organization', () => {
      // The guard against a caller passing the wrong roster — which would be a
      // cross-tenant disclosure, not a cosmetic bug.
      const mixed = [
        admin,
        { userId: 'u-intruder', role: 'ADMIN', organizationId: OTHER_ORG },
      ];
      const recipients = selectRecipients(mixed, {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.MEMBER_JOINED,
      });
      expect(recipients).toEqual(['u-admin']);
    });

    it('returns nobody when the whole roster is from another organization', () => {
      const recipients = selectRecipients(
        [{ userId: 'u-intruder', role: 'ADMIN', organizationId: OTHER_ORG }],
        { organizationId: ORG, type: NOTIFICATION_TYPES.NEW_SUBMISSION },
      );
      expect(recipients).toEqual([]);
    });
  });

  describe('actor exclusion', () => {
    it('does not notify the user who caused the event', () => {
      const recipients = selectRecipients(roster, {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.NEW_SUBMISSION,
        actorUserId: 'u-editor',
      });
      expect(recipients).toEqual(['u-admin', 'u-viewer']);
    });

    it('leaves an org with a single admin actor with nobody to tell', () => {
      // A legitimate empty result, not an error: the one person who could be
      // told is the one who did it.
      const recipients = selectRecipients([admin], {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.MEMBER_JOINED,
        actorUserId: 'u-admin',
      });
      expect(recipients).toEqual([]);
    });
  });

  describe('robustness', () => {
    it('fails closed on an unrecognised notification type', () => {
      const recipients = selectRecipients(roster, {
        organizationId: ORG,
        type: 'form_deleted' as any,
      });
      expect(recipients).toEqual([]);
    });

    it('deduplicates a user appearing twice in the roster', () => {
      const recipients = selectRecipients([admin, admin], {
        organizationId: ORG,
        type: NOTIFICATION_TYPES.MEMBER_JOINED,
      });
      expect(recipients).toEqual(['u-admin']);
    });

    it('handles an empty roster', () => {
      expect(
        selectRecipients([], {
          organizationId: ORG,
          type: NOTIFICATION_TYPES.NEW_SUBMISSION,
        }),
      ).toEqual([]);
    });
  });
});

/**
 * The threshold detector has to fire exactly once per threshold per month while
 * N pods increment the same Redis counter concurrently. It does that by keying
 * off the single increment that steps over the line, so these cases are about
 * the boundary rather than about the arithmetic.
 */
describe('crossedQuotaThreshold', () => {
  it('fires on the increment that reaches 80%', () => {
    expect(crossedQuotaThreshold(79, 80, 100)).toBe(80);
  });

  it('does not fire on the increment before, or any increment after', () => {
    expect(crossedQuotaThreshold(78, 79, 100)).toBeNull();
    expect(crossedQuotaThreshold(80, 81, 100)).toBeNull();
    expect(crossedQuotaThreshold(95, 96, 100)).toBeNull();
  });

  it('fires again at 100%', () => {
    expect(crossedQuotaThreshold(99, 100, 100)).toBe(100);
    expect(crossedQuotaThreshold(100, 101, 100)).toBeNull();
  });

  it('rounds the threshold up rather than down', () => {
    // 80% of 7 is 5.6. Rounding down would fire on submission 5 — 71% of the
    // real allowance — and call it "80%".
    expect(crossedQuotaThreshold(4, 5, 7)).toBeNull();
    expect(crossedQuotaThreshold(5, 6, 7)).toBe(80);
  });

  it('reports the higher threshold when one increment clears both', () => {
    // On an allowance of 1 the 80% and 100% marks are the same submission.
    // Reporting 80% there would understate a quota that is now exhausted.
    expect(crossedQuotaThreshold(0, 1, 1)).toBe(100);
  });

  it('returns null for a nonsensical limit rather than dividing by zero', () => {
    expect(crossedQuotaThreshold(0, 1, 0)).toBeNull();
    expect(crossedQuotaThreshold(0, 1, -5)).toBeNull();
    expect(crossedQuotaThreshold(0, 1, Number.NaN)).toBeNull();
  });

  it('returns null when the counter did not advance', () => {
    // The release path decrements after a rejected submission; a stale or
    // replayed pair must not re-fire a notification.
    expect(crossedQuotaThreshold(80, 80, 100)).toBeNull();
    expect(crossedQuotaThreshold(81, 80, 100)).toBeNull();
  });
});
