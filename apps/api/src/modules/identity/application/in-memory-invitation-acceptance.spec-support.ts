import { randomUUID } from 'node:crypto';

import { type CareRelationship } from '../domain/care-relationship';
import { type ConsentToGrant, type ConsentType } from '../domain/consent';
import { ProfileIsNotPatientError } from '../domain/identity-errors';
import { type Invitation } from '../domain/invitation';
import {
  type AcceptedInvitation,
  type InvitationAcceptance,
} from '../domain/invitation-acceptance';
import { type PersonRole } from '../domain/person';
import { type InvitationAcceptanceRepository } from './ports/invitation-acceptance.port';

/**
 * The acceptance repository without a database, for the tests that are about
 * the use case and not about the SQL.
 *
 * What it reproduces faithfully is what the use case leans on: an invitation
 * is found by the hash of its token and comes back whatever state it is in, a
 * link that is no longer acceptable writes nothing, and a person who is
 * already a patient gains the new care link and nothing else. The rows it
 * wrote are public, so a test can say what was and was not written.
 *
 * What only a real Postgres can prove — the transaction rolling back as a
 * whole, the unique indexes, two acceptances of the same link in the same
 * instant — is `accept-invitation.use-case.integration-spec.ts` (CLAUDE.md,
 * "Testes").
 */

/** A profile as this fake keeps it. No data of a real person goes in it. */
interface StoredProfile {
  readonly id: string;
  readonly role: PersonRole;
  readonly fullName: string;
  readonly timeZone: string;
}

/** A consent row, with the version of the terms it was given against. */
interface StoredConsent {
  readonly profileId: string;
  readonly type: ConsentType;
  readonly termsVersion: string;
  readonly grantedAt: Date;
}

export class InMemoryInvitationAcceptanceRepository implements InvitationAcceptanceRepository {
  private readonly invitations = new Map<string, Invitation>();
  private readonly invitationIdByTokenHash = new Map<string, string>();

  /** Every row the acceptances wrote, for the assertions to read. */
  readonly profiles = new Map<string, StoredProfile>();
  readonly patients = new Set<string>();
  readonly careRelationships: CareRelationship[] = [];
  readonly consents: StoredConsent[] = [];

  /** Puts an invitation behind a token hash, as the creation would have. */
  seed(invitation: Invitation, tokenHash: string): Invitation {
    this.invitations.set(invitation.id, invitation);
    this.invitationIdByTokenHash.set(tokenHash, invitation.id);

    return invitation;
  }

  /** The invitation as it stands now, for a test that has just accepted it. */
  invitationById(invitationId: string): Invitation | undefined {
    return this.invitations.get(invitationId);
  }

  findByTokenHash(tokenHash: string): Promise<Invitation | undefined> {
    const invitationId = this.invitationIdByTokenHash.get(tokenHash);

    return Promise.resolve(
      invitationId === undefined ? undefined : this.invitations.get(invitationId),
    );
  }

  accept(acceptance: InvitationAcceptance): Promise<AcceptedInvitation | undefined> {
    const found = this.invitations.get(acceptance.invitationId);

    // The same condition the `update ... where` of the real one carries: never
    // used, never revoked, not past its expiry at the instant of the write.
    if (
      found === undefined ||
      found.acceptedAt !== null ||
      found.revokedAt !== null ||
      found.expiresAt.getTime() < acceptance.acceptedAt.getTime()
    ) {
      return Promise.resolve(undefined);
    }

    this.invitations.set(found.id, { ...found, acceptedAt: acceptance.acceptedAt });

    const person = this.ensureProfile(acceptance);

    return Promise.resolve({
      profileId: person.id,
      organizationId: acceptance.organizationId,
      careRelationshipId: this.ensureCareRelationship(acceptance, person.id),
      acceptedAt: acceptance.acceptedAt,
      consents: this.grantConsents(acceptance.consents, person.id),
    });
  }

  /**
   * The profile keyed by the Supabase user id, written once. A person who is
   * already there keeps the name and the zone they registered with.
   */
  private ensureProfile(acceptance: InvitationAcceptance): StoredProfile {
    const existing = this.profiles.get(acceptance.patient.authUserId);

    if (existing !== undefined) {
      if (existing.role !== 'patient') throw new ProfileIsNotPatientError();

      return existing;
    }

    const person: StoredProfile = {
      id: randomUUID(),
      role: acceptance.patient.role,
      fullName: acceptance.patient.fullName,
      timeZone: acceptance.patient.timeZone,
    };

    this.profiles.set(acceptance.patient.authUserId, person);
    this.patients.add(person.id);

    return person;
  }

  /** One link per practice and patient; a link that had ended starts again. */
  private ensureCareRelationship(
    acceptance: InvitationAcceptance,
    patientProfileId: string,
  ): string {
    const index = this.careRelationships.findIndex(
      (relationship) =>
        relationship.organizationId === acceptance.organizationId &&
        relationship.patientProfileId === patientProfileId,
    );

    const existing = this.careRelationships[index];

    if (existing !== undefined) {
      if (existing.endedAt === null) return existing.id;

      this.careRelationships[index] = {
        ...existing,
        invitationId: acceptance.invitationId,
        startedAt: acceptance.acceptedAt,
        endedAt: null,
      };

      return existing.id;
    }

    const created: CareRelationship = {
      id: randomUUID(),
      organizationId: acceptance.organizationId,
      patientProfileId,
      invitationId: acceptance.invitationId,
      startedAt: acceptance.acceptedAt,
      endedAt: null,
    };

    this.careRelationships.push(created);

    return created.id;
  }

  /** Only the purposes that are not in force yet become rows. */
  private grantConsents(
    toGrant: readonly ConsentToGrant[],
    profileId: string,
  ): readonly ConsentType[] {
    const already = new Set(
      this.consents.filter((stored) => stored.profileId === profileId).map((stored) => stored.type),
    );

    for (const consent of toGrant) {
      if (already.has(consent.type)) continue;

      this.consents.push({
        profileId,
        type: consent.type,
        termsVersion: consent.termsVersion,
        grantedAt: consent.grantedAt,
      });
      already.add(consent.type);
    }

    return [...already];
  }
}
