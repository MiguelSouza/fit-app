import { randomUUID } from 'node:crypto';

import { type CareRelationship } from '../domain/care-relationship';
import { type ConsentType } from '../domain/consent';
import { SHARE_WITH_PROFESSIONAL, type PatientAccessFacts } from '../domain/patient-access';
import { type ProfessionalType } from '../domain/person';
import { type PatientAccessRepository } from './ports/patient-access.port';

/**
 * The facts of the access rule without a database, for the tests that are
 * about the service and about the guard rather than about the SQL.
 *
 * What it reproduces faithfully is the one thing the rule leans on: a link is
 * only visible to a professional of **its own practice**, so a link of another
 * organization is simply not among the facts — which is how the real query,
 * joining `care_relationship` to `organization_member`, answers too. The
 * consent belongs to the patient, as the column does, and it is in force until
 * it is revoked.
 *
 * What only a real Postgres can prove is `patient-access.service.
 * integration-spec.ts` (CLAUDE.md, "Testes"). No data of a real person goes in
 * here: every id is random and nothing has a name.
 */
export class InMemoryPatientAccessRepository implements PatientAccessRepository {
  private readonly professionals = new Map<
    string,
    { readonly type: ProfessionalType; readonly organizationIds: Set<string> }
  >();

  private readonly links: CareRelationship[] = [];

  /** `${profileId}:${type}` for every consent in force. A revocation removes it. */
  private readonly consentsInForce = new Set<string>();

  /** How many times the facts were read, for a test about not caching them. */
  reads = 0;

  /**
   * A professional of a practice, as the registration of card I-01 creates
   * one. The ids can be given, for the tests that already hold them — the
   * guard's, where the profile id comes from the identity registry.
   */
  addProfessional(
    options: {
      readonly profileId?: string;
      readonly type?: ProfessionalType;
      readonly organizationId?: string;
    } = {},
  ): { profileId: string; organizationId: string } {
    const profileId = options.profileId ?? randomUUID();
    const organizationId = options.organizationId ?? randomUUID();

    this.professionals.set(profileId, {
      type: options.type ?? 'nutritionist',
      organizationIds: new Set([organizationId]),
    });

    return { profileId, organizationId };
  }

  /** A care link, as accepting an invitation creates one (card I-03). */
  addCareRelationship(
    organizationId: string,
    patientProfileId: string,
    endedAt: Date | null = null,
  ): CareRelationship {
    const link: CareRelationship = {
      id: randomUUID(),
      organizationId,
      patientProfileId,
      invitationId: randomUUID(),
      startedAt: new Date('2026-10-01T12:00:00Z'),
      endedAt,
    };

    this.links.push(link);

    return link;
  }

  grant(patientProfileId: string, type: ConsentType = SHARE_WITH_PROFESSIONAL): void {
    this.consentsInForce.add(`${patientProfileId}:${type}`);
  }

  revoke(patientProfileId: string, type: ConsentType = SHARE_WITH_PROFESSIONAL): void {
    this.consentsInForce.delete(`${patientProfileId}:${type}`);
  }

  findFacts(professionalProfileId: string, patientProfileId: string): Promise<PatientAccessFacts> {
    this.reads += 1;

    const professional = this.professionals.get(professionalProfileId);

    if (professional === undefined) {
      return Promise.resolve({
        professionalType: null,
        careRelationships: [],
        shareWithProfessionalInForce: false,
      });
    }

    return Promise.resolve({
      professionalType: professional.type,
      // Only the links of the practices this professional belongs to, which is
      // what the join in the real repository restricts them to.
      careRelationships: this.links.filter(
        (link) =>
          link.patientProfileId === patientProfileId &&
          professional.organizationIds.has(link.organizationId),
      ),
      shareWithProfessionalInForce: this.consentsInForce.has(
        `${patientProfileId}:${SHARE_WITH_PROFESSIONAL}`,
      ),
    });
  }
}
