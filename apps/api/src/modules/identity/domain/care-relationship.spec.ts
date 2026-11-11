import { randomUUID } from 'node:crypto';

import {
  careRelationshipStatusOf,
  decideCareRelationshipToEnd,
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

/**
 * Which link ending the follow-up would date (card I-07). The two refusals are
 * what the two sides of the card word differently, so they are kept apart here
 * as codes and nothing in this file knows about HTTP.
 */
describe('decideCareRelationshipToEnd', () => {
  it('picks the active link', () => {
    const active = relationship(null);

    expect(decideCareRelationshipToEnd([active])).toEqual({ canEnd: true, relationship: active });
  });

  it('refuses when the professional practices never followed this patient', () => {
    expect(decideCareRelationshipToEnd([])).toEqual({
      canEnd: false,
      refusal: 'no_care_relationship',
    });
  });

  it('refuses a follow-up that is already over, and says so', () => {
    // Not the same answer as "there is no link": the second ending is a 409,
    // and a patient of theirs is never answered as a patient that is not there.
    expect(decideCareRelationshipToEnd([relationship(new Date('2026-11-01T12:00:00Z'))])).toEqual({
      canEnd: false,
      refusal: 'already_ended',
    });
  });

  it('picks the active link among the links of two practices', () => {
    // Today a professional belongs to one practice (ADR 0014); the day a
    // clinic member belongs to two, one ended link next to an active one is
    // not a refusal.
    const ended = relationship(new Date('2026-11-01T12:00:00Z'));
    const active = relationship(null);

    expect(decideCareRelationshipToEnd([ended, active])).toEqual({
      canEnd: true,
      relationship: active,
    });
  });
});
