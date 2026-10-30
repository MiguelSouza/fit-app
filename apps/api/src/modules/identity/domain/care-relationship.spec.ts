import { randomUUID } from 'node:crypto';

import {
  careRelationshipStatusOf,
  isActiveCareRelationship,
  type CareRelationship,
} from './care-relationship';

/**
 * The status of a link, read off the dates and not off a column — the same
 * choice the invitation makes (ADR 0015), tested here because every
 * authorization rule of this platform is going to ask this question
 * (CLAUDE.md, "Saúde e LGPD": an **active** link and a consent in force).
 */
function relationship(endedAt: Date | null): CareRelationship {
  return {
    id: randomUUID(),
    organizationId: randomUUID(),
    patientProfileId: randomUUID(),
    invitationId: randomUUID(),
    startedAt: new Date('2026-10-30T12:00:00Z'),
    endedAt,
  };
}

describe('careRelationshipStatusOf', () => {
  it('reads a link with no end as active', () => {
    expect(careRelationshipStatusOf(relationship(null))).toBe('active');
    expect(isActiveCareRelationship(relationship(null))).toBe(true);
  });

  it('reads a link that ended as ended', () => {
    const ended = relationship(new Date('2026-11-30T12:00:00Z'));

    expect(careRelationshipStatusOf(ended)).toBe('ended');
    expect(isActiveCareRelationship(ended)).toBe(false);
  });
});
