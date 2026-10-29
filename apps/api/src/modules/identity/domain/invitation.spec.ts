import { randomUUID } from 'node:crypto';

import {
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationRevokedError,
} from './identity-errors';
import {
  INVITATION_LIFETIME_IN_DAYS,
  invitationReadyToAccept,
  invitationStatusOf,
  invitationToCreate,
  isPending,
  type Invitation,
} from './invitation';

/**
 * The rules of an invitation, as the domain decides them: how long it lives,
 * what it is at a given instant, and when it may no longer be accepted
 * (CLAUDE.md, "Testes": the domain's tests are mandatory).
 *
 * Every instant below is explicit. Nothing here reads the clock, which is what
 * lets "expired" be a date in the past instead of a two week wait.
 */
const NOW = new Date('2026-03-10T12:00:00.000Z');

/** Two weeks after `NOW`, written out, so the test does not do the sum twice. */
const EXPIRES_AT = new Date('2026-03-24T12:00:00.000Z');

const ORGANIZATION_ID = randomUUID();
const INVITED_BY_PROFILE_ID = randomUUID();

/** A hash, which is the only form of the token the domain ever sees. */
const TOKEN_HASH = 'b'.repeat(64);

function request(
  overrides: Partial<Parameters<typeof invitationToCreate>[0]> = {},
): Parameters<typeof invitationToCreate>[0] {
  return {
    organizationId: ORGANIZATION_ID,
    invitedByProfileId: INVITED_BY_PROFILE_ID,
    name: null,
    contact: null,
    tokenHash: TOKEN_HASH,
    now: NOW,
    ...overrides,
  };
}

/** An invitation as the repository reads it back: pending, unless said otherwise. */
function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: randomUUID(),
    organizationId: ORGANIZATION_ID,
    name: null,
    contact: null,
    createdAt: NOW,
    expiresAt: EXPIRES_AT,
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('invitationToCreate', () => {
  it('expires fourteen days after the invitation was made', () => {
    expect(INVITATION_LIFETIME_IN_DAYS).toBe(14);
    expect(invitationToCreate(request()).expiresAt).toEqual(EXPIRES_AT);
  });

  it('belongs to the organization it was given, and records who invited', () => {
    expect(invitationToCreate(request())).toMatchObject({
      organizationId: ORGANIZATION_ID,
      invitedByProfileId: INVITED_BY_PROFILE_ID,
      tokenHash: TOKEN_HASH,
    });
  });

  it('collapses the whitespace of what the professional typed', () => {
    expect(
      invitationToCreate(request({ name: '  Ana   Paula ', contact: ' +55 11  90000-0000 ' })),
    ).toMatchObject({ name: 'Ana Paula', contact: '+55 11 90000-0000' });
  });

  it('reads a field of only spaces as the absence it is', () => {
    expect(invitationToCreate(request({ name: '   ', contact: '' }))).toMatchObject({
      name: null,
      contact: null,
    });
  });

  it('accepts an invitation with no name and no contact', () => {
    // The professional is already talking to the person on WhatsApp: the link
    // is the whole message, and the name is only there for the list.
    expect(invitationToCreate(request())).toMatchObject({ name: null, contact: null });
  });
});

describe('invitationStatusOf', () => {
  it('is pending while the fourteen days last', () => {
    expect(invitationStatusOf(invitation(), NOW)).toBe('pending');
    expect(isPending(invitation(), NOW)).toBe(true);
  });

  it('is still pending on the very instant it expires', () => {
    expect(invitationStatusOf(invitation(), EXPIRES_AT)).toBe('pending');
  });

  it('is expired a millisecond later', () => {
    const justAfter = new Date(EXPIRES_AT.getTime() + 1);

    expect(invitationStatusOf(invitation(), justAfter)).toBe('expired');
    expect(isPending(invitation(), justAfter)).toBe(false);
  });

  it('is revoked once the professional takes it back', () => {
    expect(invitationStatusOf(invitation({ revokedAt: NOW }), NOW)).toBe('revoked');
  });

  it('is accepted once it was used', () => {
    expect(invitationStatusOf(invitation({ acceptedAt: NOW }), NOW)).toBe('accepted');
  });

  it('says accepted, not expired, about a link that was used and then aged', () => {
    // What happened to the invitation is that somebody used it. Reporting
    // "expired" two weeks later would be a lie about the patient who is
    // already in.
    const longAfter = new Date('2026-06-01T00:00:00.000Z');

    expect(invitationStatusOf(invitation({ acceptedAt: NOW }), longAfter)).toBe('accepted');
  });

  it('says revoked, not expired, about a link that was taken back and then aged', () => {
    const longAfter = new Date('2026-06-01T00:00:00.000Z');

    expect(invitationStatusOf(invitation({ revokedAt: NOW }), longAfter)).toBe('revoked');
  });
});

describe('invitationReadyToAccept', () => {
  it('lets a pending invitation through', () => {
    const pending = invitation();

    expect(invitationReadyToAccept(pending, NOW)).toBe(pending);
  });

  it('refuses an expired one', () => {
    const justAfter = new Date(EXPIRES_AT.getTime() + 1);

    expect(() => invitationReadyToAccept(invitation(), justAfter)).toThrow(InvitationExpiredError);
  });

  it('refuses a revoked one', () => {
    expect(() => invitationReadyToAccept(invitation({ revokedAt: NOW }), NOW)).toThrow(
      InvitationRevokedError,
    );
  });

  it('refuses one that was already accepted: the link is of single use', () => {
    expect(() => invitationReadyToAccept(invitation({ acceptedAt: NOW }), NOW)).toThrow(
      InvitationAlreadyAcceptedError,
    );
  });

  it('refuses one that is both revoked and expired, and says it was cancelled', () => {
    // The professional acted; the clock only ran out afterwards. Which message
    // the patient reads matters, and it is the one about what somebody did.
    const longAfter = new Date('2026-06-01T00:00:00.000Z');

    expect(() => invitationReadyToAccept(invitation({ revokedAt: NOW }), longAfter)).toThrow(
      InvitationRevokedError,
    );
  });
});
