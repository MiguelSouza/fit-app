/**
 * The link between a practice and a patient: the "vínculo" every rule of this
 * platform asks about (CLAUDE.md, "Saúde e LGPD" — a professional only reaches
 * a patient with an **active link** and a consent in force).
 *
 * Pure: no NestJS, no Drizzle, no I/O (CLAUDE.md rule 4).
 *
 * It belongs to the organization and not to the professional who invited,
 * exactly as the invitation does (ADR 0015): the practice is what the patient
 * joined, and in a clinic another member has to be able to take over the
 * follow-up without the link being recreated. Who invited is kept on the
 * invitation the link came from.
 *
 * **There is no status column**, for the same reason the invitation has none:
 * `active` and `ended` are read off `endedAt` at the instant somebody asks, so
 * there is no row that disagrees with the clock and no job keeping one honest.
 */

/** Whether the practice still follows this patient. */
export type CareRelationshipStatus = 'active' | 'ended';

/** A link as it stands, read back from the repository. Every instant is UTC. */
export interface CareRelationship {
  readonly id: string;
  readonly organizationId: string;
  readonly patientProfileId: string;
  /** The invitation the patient came in through. */
  readonly invitationId: string;
  readonly startedAt: Date;
  /** `null` while the follow-up is on. Set when it ends, and never unset. */
  readonly endedAt: Date | null;
}

/** The row the repository writes when an invitation is accepted. */
export interface CareRelationshipToCreate {
  readonly organizationId: string;
  readonly patientProfileId: string;
  readonly invitationId: string;
  readonly startedAt: Date;
}

export function careRelationshipStatusOf(relationship: CareRelationship): CareRelationshipStatus {
  return relationship.endedAt === null ? 'active' : 'ended';
}

/**
 * Whether the professional side may still read this patient — half of the
 * answer, the consent in force being the other half.
 */
export function isActiveCareRelationship(relationship: CareRelationship): boolean {
  return careRelationshipStatusOf(relationship) === 'active';
}
