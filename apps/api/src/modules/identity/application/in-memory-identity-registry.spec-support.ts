import { randomUUID } from 'node:crypto';

import { type ProfessionalRegistration } from '../domain/professional-registration';
import { type RegisteredIdentity } from '../domain/registered-identity';
import { type IdentityRegistry } from './ports/identity-registry.port';

/**
 * The registry without a database, for the tests that are about the use case
 * and not about the SQL: it keeps the rows in a map and answers the port.
 *
 * What it reproduces faithfully is the one behaviour the use cases lean on —
 * registering a Supabase user that is already registered writes nothing and
 * answers `undefined`, as the unique index makes the real one do. What only
 * the real one can prove is that the four rows land together and that two
 * requests at the same instant cannot both insert; that is
 * `register-professional.use-case.integration-spec.ts`, against a real
 * Postgres (CLAUDE.md, "Testes").
 */
export class InMemoryIdentityRegistry implements IdentityRegistry {
  private readonly byAuthUserId = new Map<string, RegisteredIdentity>();

  /** How many times a registration was actually written. */
  registrations = 0;

  constructor(initial: Readonly<Record<string, RegisteredIdentity>> = {}) {
    for (const [authUserId, identity] of Object.entries(initial)) {
      this.byAuthUserId.set(authUserId, identity);
    }
  }

  findByAuthUserId(authUserId: string): Promise<RegisteredIdentity | undefined> {
    return Promise.resolve(this.byAuthUserId.get(authUserId));
  }

  createProfessional(
    registration: ProfessionalRegistration,
  ): Promise<RegisteredIdentity | undefined> {
    if (this.byAuthUserId.has(registration.authUserId)) return Promise.resolve(undefined);

    const identity: RegisteredIdentity = {
      personId: randomUUID(),
      role: registration.role,
      fullName: registration.fullName,
      timeZone: registration.timeZone,
      professional: {
        type: registration.professionalType,
        councilNumber: registration.councilNumber,
        specialty: registration.specialty,
      },
      organizations: [
        {
          organizationId: randomUUID(),
          name: registration.organization.name,
          kind: registration.organization.kind,
          role: registration.membershipRole,
        },
      ],
    };

    this.byAuthUserId.set(registration.authUserId, identity);
    this.registrations += 1;

    return Promise.resolve(identity);
  }
}

/**
 * A patient's identity, for the tests about posting to the professional
 * endpoint with an account that is not one. No name and no data of a real
 * person: the id is random and the fields are the least a patient can have.
 */
export function patientIdentity(): RegisteredIdentity {
  return {
    personId: randomUUID(),
    role: 'patient',
    fullName: 'Paciente de teste',
    timeZone: 'America/Sao_Paulo',
    professional: null,
    organizations: [],
  };
}

/**
 * A professional's identity, already registered, for the tests of the use
 * cases whose subject is a professional of a practice — the invitations of
 * card I-02.
 *
 * The practice is a parameter because that is what those tests are about: two
 * professionals of two organizations, and neither seeing the other's
 * invitations. No data of a real person: random ids, and a name that is a
 * label.
 */
export function professionalIdentity(organizationId: string = randomUUID()): RegisteredIdentity {
  return {
    personId: randomUUID(),
    role: 'professional',
    fullName: 'Profissional de teste',
    timeZone: 'America/Sao_Paulo',
    professional: { type: 'nutritionist', councilNumber: 'CRN-3 12345', specialty: null },
    organizations: [
      {
        organizationId,
        name: 'Consultório de teste',
        kind: 'solo',
        role: 'owner',
      },
    ],
  };
}
