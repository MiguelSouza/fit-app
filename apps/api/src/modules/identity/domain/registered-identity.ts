import { type OrganizationKind, type OrganizationRole } from './organization';
import { type PersonRole, type ProfessionalType } from './person';

/**
 * Who a registered person is, as the module answers it about **themselves**.
 *
 * Pure: it is a shape, with no behaviour and no I/O (CLAUDE.md rule 4). The
 * presenter turns it into the `MeResponse` of the contract.
 *
 * It is the caller's own identity and nobody else's. Reading another person —
 * a professional opening a patient's chart — is a different use case, with the
 * link, the consent and the access log that come with it (CLAUDE.md, "Saúde e
 * LGPD").
 */
export interface RegisteredIdentity {
  /** The platform's id for the person, which is ours and not Supabase's. */
  readonly personId: string;
  readonly role: PersonRole;
  readonly fullName: string;
  readonly timeZone: string;
  /** `null` for a patient, who has no council number. */
  readonly professional: ProfessionalDetails | null;
  /**
   * The practices the person belongs to. A membership belongs to the profile,
   * which is why it sits here and not inside `professional` — on the wire the
   * contract nests it, because today only a professional has any.
   */
  readonly organizations: readonly OrganizationMembership[];
}

/** The professional half: what the rules check before letting an edit through. */
export interface ProfessionalDetails {
  readonly type: ProfessionalType;
  readonly councilNumber: string;
  readonly specialty: string | null;
}

/** One practice the person belongs to, and as what. */
export interface OrganizationMembership {
  readonly organizationId: string;
  readonly name: string;
  readonly kind: OrganizationKind;
  readonly role: OrganizationRole;
}
