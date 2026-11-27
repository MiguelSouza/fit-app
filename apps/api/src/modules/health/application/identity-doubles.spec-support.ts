import {
  AccessLogService,
  LoadPatientCaller,
  LoadProfessionalCaller,
  PatientAccessService,
  type AccessLogAction,
  type AccessLogResource,
  type PatientCaller,
} from '../../identity';
import { NotFoundError, PermissionDeniedError } from '../../../shared/domain/domain-error';

/**
 * `identity`, as a `health` test stands it in: the four names its `index.ts`
 * hands out, and nothing else.
 *
 * **Why they are stubbed at that surface and not deeper.** A module never
 * imports another module's files (CLAUDE.md rule 1), so this file cannot reach
 * `identity`'s own doubles, its ports or its error classes — and it should not
 * want to. What a `health` suite has to prove is that it **asks** the right
 * questions: who is calling, may this professional see this patient, and
 * record that they did. Whether the access rule itself is right, and whether a
 * revoked consent cuts somebody off on the next request, is `identity`'s and is
 * tested there (ADR 0017).
 *
 * The refusals are written as the **shared** domain errors carrying
 * `identity`'s codes. The status code a client sees comes from the `kind` and
 * the code it keys its i18n off comes from `code`, and those are exactly what
 * these carry — so a `health` suite asserts the answer a client really gets
 * without naming a class that lives behind a boundary.
 *
 * The casts are the honest way round: these classes keep private fields, so an
 * object with the right methods does not satisfy them structurally, and the
 * alternative would be the forbidden import.
 *
 * Not a `*.spec.ts` file, so jest does not read it as a suite, and excluded
 * from `tsconfig.build.json`, so it never reaches `dist/`.
 */

/** What `identity` answers a professional who asked for a patient route. */
export function notAPatient(): PermissionDeniedError {
  return new PermissionDeniedError(
    'identity.patient.required',
    'Só o próprio paciente pode dar e revogar consentimentos.',
  );
}

/** What it answers a patient who asked for a professional route. */
export function notAProfessional(): PermissionDeniedError {
  return new PermissionDeniedError(
    'identity.professional.required',
    'Só um profissional pode convidar e acompanhar pacientes.',
  );
}

/**
 * The one refusal of the access rule: no link, no consent and no such person
 * are the same 404, so trying ids tells a caller nothing (ADR 0017).
 */
export function noSuchPatient(): NotFoundError {
  return new NotFoundError('identity.patient.not_found', 'Paciente não encontrado.');
}

/**
 * The caller as a patient — or nobody, which is what `identity` answers for a
 * professional.
 */
export function patientCallers(patient: PatientCaller | undefined): LoadPatientCaller {
  return {
    execute: () =>
      patient === undefined ? Promise.reject(notAPatient()) : Promise.resolve(patient),
    patientProfileId: () =>
      patient === undefined ? Promise.reject(notAPatient()) : Promise.resolve(patient.profileId),
  } as unknown as LoadPatientCaller;
}

/** The caller as a professional, by profile id — or nobody. */
export function professionalCallers(profileId: string | undefined): LoadProfessionalCaller {
  return {
    professionalProfileId: () =>
      profileId === undefined ? Promise.reject(notAProfessional()) : Promise.resolve(profileId),
  } as unknown as LoadProfessionalCaller;
}

/** The access rule, answering the same way for every patient. */
export function patientAccess(granted: boolean): PatientAccessService {
  return {
    canAccessPatient: () => Promise.resolve(granted),
    assertCanAccessPatient: () => (granted ? Promise.resolve() : Promise.reject(noSuchPatient())),
  } as unknown as PatientAccessService;
}

/** One row the access log was asked to write. */
export interface RecordedAccess {
  readonly actorProfileId: string;
  readonly patientProfileId: string;
  readonly resource: AccessLogResource;
  readonly action: AccessLogAction;
}

/** The access log as a list, for a suite that asserts what was recorded. */
export function recordingAccessLog(into: RecordedAccess[]): AccessLogService {
  return {
    logAccess: (
      actorProfileId: string,
      patientProfileId: string,
      resource: AccessLogResource,
      action: AccessLogAction,
    ) => {
      into.push({ actorProfileId, patientProfileId, resource, action });

      return Promise.resolve();
    },
  } as unknown as AccessLogService;
}
