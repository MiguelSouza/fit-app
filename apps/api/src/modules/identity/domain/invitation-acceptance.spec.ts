import { randomUUID } from 'node:crypto';

import { CURRENT_TERMS_VERSION, type ConsentType } from './consent';
import {
  BlankPatientNameError,
  InvitationAlreadyAcceptedError,
  InvitationExpiredError,
  InvitationRevokedError,
  MissingRequiredConsentError,
  UnknownTimeZoneError,
} from './identity-errors';
import { type Invitation } from './invitation';
import { invitationAcceptanceOf } from './invitation-acceptance';
import { DEFAULT_TIME_ZONE } from './person';

/**
 * What accepting a link turns into, decided without a database (card I-03).
 *
 * Pure input, pure output: an invitation as it stands, what the patient filled
 * in, and the instant. What comes out is what the repository writes, and the
 * three refusals of the card — a used, revoked or expired link — happen here.
 */
const NOW = new Date('2026-10-30T12:00:00Z');
const ORGANIZATION_ID = randomUUID();
const AUTH_USER_ID = randomUUID();

const CONSENTS: readonly ConsentType[] = ['health_data', 'share_with_professional'];

/** A pending invitation of a practice, a week from expiring. */
function pendingInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: randomUUID(),
    organizationId: ORGANIZATION_ID,
    name: null,
    contact: null,
    createdAt: new Date('2026-10-25T12:00:00Z'),
    expiresAt: new Date('2026-11-08T12:00:00Z'),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function acceptance(
  invitation: Invitation,
  fullName = 'Ana Souza',
  timeZone: string | null = null,
) {
  return invitationAcceptanceOf({
    invitation,
    authUserId: AUTH_USER_ID,
    fullName,
    timeZone,
    consents: CONSENTS,
    now: NOW,
  });
}

describe('invitationAcceptanceOf', () => {
  it('starts the patient as a patient, in the practice of the invitation', () => {
    const invitation = pendingInvitation();

    expect(acceptance(invitation)).toMatchObject({
      invitationId: invitation.id,
      organizationId: ORGANIZATION_ID,
      acceptedAt: NOW,
      patient: { authUserId: AUTH_USER_ID, role: 'patient', fullName: 'Ana Souza' },
    });
  });

  it('records the consents with the version of the terms', () => {
    expect(acceptance(pendingInvitation()).consents).toEqual([
      { type: 'health_data', termsVersion: CURRENT_TERMS_VERSION, grantedAt: NOW },
      { type: 'share_with_professional', termsVersion: CURRENT_TERMS_VERSION, grantedAt: NOW },
    ]);
  });

  it('defaults the time zone to the platform one when nobody said', () => {
    expect(acceptance(pendingInvitation()).patient.timeZone).toBe(DEFAULT_TIME_ZONE);
  });

  it('keeps the zone the patient is in, which is what dates a night of sleep', () => {
    expect(acceptance(pendingInvitation(), 'Ana Souza', 'America/Bahia').patient.timeZone).toBe(
      'America/Bahia',
    );
  });

  it('treats a zone of spaces as a zone nobody said', () => {
    expect(acceptance(pendingInvitation(), 'Ana Souza', '   ').patient.timeZone).toBe(
      DEFAULT_TIME_ZONE,
    );
  });

  it('refuses a zone the IANA database does not have, instead of storing it', () => {
    expect(() => acceptance(pendingInvitation(), 'Ana Souza', 'Mars/Phobos')).toThrow(
      UnknownTimeZoneError,
    );
  });

  it('refuses something that is not a zone at all', () => {
    expect(() => acceptance(pendingInvitation(), 'Ana Souza', 'de madrugada')).toThrow(
      UnknownTimeZoneError,
    );
  });

  it('keeps UTC, which is a zone a client may well send', () => {
    expect(acceptance(pendingInvitation(), 'Ana Souza', 'UTC').patient.timeZone).toBe('UTC');
  });

  it('squeezes the name, so one person is not two rows', () => {
    expect(acceptance(pendingInvitation(), '  Ana   Souza ').patient.fullName).toBe('Ana Souza');
  });

  it('refuses a name that is only whitespace', () => {
    expect(() => acceptance(pendingInvitation(), '   ')).toThrow(BlankPatientNameError);
  });

  it('refuses a link that was already used: it is of single use', () => {
    const used = pendingInvitation({ acceptedAt: new Date('2026-10-28T12:00:00Z') });

    expect(() => acceptance(used)).toThrow(InvitationAlreadyAcceptedError);
  });

  it('refuses a link the professional took back', () => {
    const revoked = pendingInvitation({ revokedAt: new Date('2026-10-28T12:00:00Z') });

    expect(() => acceptance(revoked)).toThrow(InvitationRevokedError);
  });

  it('refuses a link whose fourteen days are gone', () => {
    const expired = pendingInvitation({ expiresAt: new Date('2026-10-29T12:00:00Z') });

    expect(() => acceptance(expired)).toThrow(InvitationExpiredError);
  });

  it('refuses an acceptance without the required consents', () => {
    expect(() =>
      invitationAcceptanceOf({
        invitation: pendingInvitation(),
        authUserId: AUTH_USER_ID,
        fullName: 'Ana Souza',
        timeZone: null,
        consents: ['wearable_data'],
        now: NOW,
      }),
    ).toThrow(MissingRequiredConsentError);
  });

  it('looks at the link before the form: an expired one is not a form problem', () => {
    const expired = pendingInvitation({ expiresAt: new Date('2026-10-29T12:00:00Z') });

    expect(() =>
      invitationAcceptanceOf({
        invitation: expired,
        authUserId: AUTH_USER_ID,
        fullName: '   ',
        timeZone: null,
        consents: [],
        now: NOW,
      }),
    ).toThrow(InvitationExpiredError);
  });
});
