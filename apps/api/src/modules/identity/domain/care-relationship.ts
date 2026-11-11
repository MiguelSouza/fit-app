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
 *
 * Ending it is card I-07, and the decision of whether it *can* be ended is at
 * the bottom of this file — a pure function, like `decidePatientAccess` next
 * door, because it is asked by two use cases that refuse differently.
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

/**
 * A link that has ended: the same row, with the instant on it. The `endedAt`
 * is a `Date` and not `Date | null`, which is what lets a presenter answer it
 * without a check that cannot fail.
 */
export interface EndedCareRelationship extends Omit<CareRelationship, 'endedAt'> {
  readonly endedAt: Date;
}

/** Why ending the follow-up was refused. Codes, as everywhere in this domain. */
export type EndCareRelationshipRefusal = 'no_care_relationship' | 'already_ended';

/** The link to end, or the reason there is none to end. */
export type EndCareRelationshipDecision =
  | { readonly canEnd: true; readonly relationship: CareRelationship }
  | { readonly canEnd: false; readonly refusal: EndCareRelationshipRefusal };

/**
 * Which link — if any — ending the follow-up would date (card I-07).
 *
 * Pure (CLAUDE.md rule 4), and a decision object rather than an exception for
 * the same reason `decidePatientAccess` is one: the two sides of the card refuse
 * **differently**. A professional asking about somebody who is not their
 * patient must be answered exactly as for a patient that does not exist, and a
 * patient asking about a link that is not theirs is simply told it was not
 * found — so the refusal is a code here and each use case turns it into its own
 * error.
 *
 * It takes a **list** because that is the honest shape of the question on the
 * professional's side: the link belongs to the practice (ADR 0015), so what
 * comes back is every link between a practice this professional belongs to and
 * this patient — one row today (ADR 0014), possibly more the day a clinic has
 * members in two. The patient's side looks a link up by id and hands over the
 * one it found, or nothing.
 *
 * `already_ended` and not "fine, it is ended either way": ending a follow-up is
 * a decision the other side is told about, and answering success to the second
 * one would date the link twice, publish a second event, and make a second
 * archiving of plans look like a thing that happened.
 */
export function decideCareRelationshipToEnd(
  relationships: readonly CareRelationship[],
): EndCareRelationshipDecision {
  if (relationships.length === 0) return { canEnd: false, refusal: 'no_care_relationship' };

  const active = relationships.find(isActiveCareRelationship);

  if (active === undefined) return { canEnd: false, refusal: 'already_ended' };

  return { canEnd: true, relationship: active };
}
