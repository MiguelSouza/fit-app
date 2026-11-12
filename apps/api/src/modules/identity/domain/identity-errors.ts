import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  PermissionDeniedError,
  RuleViolationError,
} from '../../../shared/domain/domain-error';
import { type ConsentType } from './consent';

/**
 * What `identity` refuses, as domain errors. The translation to a status code
 * happens in `shared/presentation/global-exception.filter.ts` and nowhere else
 * (CLAUDE.md, "Convenções").
 *
 * The `code` is what a client keys its i18n off, so it is stable; the message
 * is pt-BR, ready to show, and carries no personal data — it travels in the
 * response and the client may log it.
 */

/**
 * The caller signed in but has no profile: they have not finished the first
 * access. 404, and it is what tells the panel which screen to open.
 */
export class ProfileNotFoundError extends NotFoundError {
  constructor() {
    super(
      'identity.profile.not_found',
      'Não encontramos seu cadastro. Conclua o primeiro acesso para continuar.',
    );
  }
}

/**
 * The caller already has a profile, and it is not a professional's. 409: the
 * account exists, and registering it as a professional would mean two roles on
 * one person — which this product does not have.
 */
export class ProfileIsNotProfessionalError extends ConflictError {
  constructor() {
    super(
      'identity.profile.not_professional',
      'Esta conta já está cadastrada como paciente e não pode virar profissional.',
    );
  }
}

/** The name is empty, or only whitespace. */
export class BlankProfessionalNameError extends InvalidInputError {
  constructor() {
    super('identity.professional.blank_name', 'Informe seu nome completo.');
  }
}

/** The council registration number is empty, or only whitespace. */
export class BlankCouncilNumberError extends InvalidInputError {
  constructor() {
    super('identity.professional.blank_council_number', 'Informe o número do seu conselho.');
  }
}

/**
 * The caller is signed in and has a profile, and it is a patient's: inviting
 * somebody is a professional's doing. 403 and not 404 — nothing is being
 * looked up, the person simply may not do this.
 */
export class CallerIsNotProfessionalError extends PermissionDeniedError {
  constructor() {
    super(
      'identity.professional.required',
      'Só um profissional pode convidar e acompanhar pacientes.',
    );
  }
}

/**
 * No invitation with that id in the caller's organization.
 *
 * It is also the answer when the invitation exists and belongs to **another**
 * practice: a professional has no business learning that an id is somebody
 * else's invitation, and a 403 there would tell them exactly that.
 */
export class InvitationNotFoundError extends NotFoundError {
  constructor() {
    super('identity.invitation.not_found', 'Convite não encontrado.');
  }
}

/**
 * Revoking only makes sense on an invitation that is still pending: one that
 * was accepted, revoked or has expired has nothing left to take back.
 */
export class InvitationNotPendingError extends ConflictError {
  constructor() {
    super(
      'identity.invitation.not_pending',
      'Este convite já não está pendente, então não há o que revogar.',
    );
  }
}

/** The fourteen days are gone. The patient asks the professional for a new link. */
export class InvitationExpiredError extends ConflictError {
  constructor() {
    super(
      'identity.invitation.expired',
      'Este convite expirou. Peça um novo link ao seu profissional.',
    );
  }
}

/** The professional took the link back before it was used. */
export class InvitationRevokedError extends ConflictError {
  constructor() {
    super(
      'identity.invitation.revoked',
      'Este convite foi cancelado. Peça um novo link ao seu profissional.',
    );
  }
}

/** The link is of single use, and it has been used. */
export class InvitationAlreadyAcceptedError extends ConflictError {
  constructor() {
    super('identity.invitation.already_accepted', 'Este convite já foi aceito.');
  }
}

/** The name the patient filled in on the acceptance is empty, or only whitespace. */
export class BlankPatientNameError extends InvalidInputError {
  constructor() {
    super('identity.patient.blank_name', 'Informe seu nome completo.');
  }
}

/**
 * The account accepting the invitation is a professional's.
 *
 * 409: the account exists and this product does not give one person two roles
 * — a nutritionist who wants to be followed as a patient signs up with another
 * account. It is the mirror of `ProfileIsNotProfessionalError` above.
 */
export class ProfileIsNotPatientError extends ConflictError {
  constructor() {
    super(
      'identity.profile.not_patient',
      'Esta conta já está cadastrada como profissional e não pode aceitar um convite de paciente.',
    );
  }
}

/**
 * The patient did not consent to what the follow-up cannot happen without:
 * `health_data`, `share_with_professional`, or both.
 *
 * 422 and not 400 — the request is well formed, and what refuses it is a rule
 * (`shared/domain/domain-error.ts`). The message names which purposes are
 * missing, in the words the screen used, so the patient knows what to tick;
 * the machine readable half is the code, which is the same whichever is
 * missing.
 */
export class MissingRequiredConsentError extends RuleViolationError {
  constructor(missing: readonly ConsentType[]) {
    super(
      'identity.consent.required_missing',
      `Para aceitar o convite é preciso concordar com ${listOf(missing)}.`,
    );
  }
}

/**
 * How each purpose is named to the patient. Only the two required ones ever
 * reach this message, and the record covers all four anyway: a purpose added
 * to the type cannot leave a hole here without the build saying so.
 */
const CONSENT_LABELS: Readonly<Record<ConsentType, string>> = {
  health_data: 'o uso dos seus dados de saúde',
  share_with_professional: 'o compartilhamento com o seu profissional',
  wearable_data: 'o uso dos dados do seu wearable',
  ai_processing: 'o processamento dos seus dados por IA',
};

/** One purpose, or two joined by "e" — which is as long as this list gets. */
function listOf(types: readonly ConsentType[]): string {
  return types.map((type) => CONSENT_LABELS[type]).join(' e ');
}

/**
 * The zone the patient sent is not a name the IANA database has.
 *
 * 400 and not a silent fallback to the platform's default: the zone decides
 * which day a night of sleep belongs to (CLAUDE.md, "Dados de saúde"), and a
 * profile quietly saved in São Paulo for somebody in Lisbon is a wrong answer
 * nobody gets told about. A client that cannot read the device's zone sends
 * nothing and gets the default on purpose.
 */
export class UnknownTimeZoneError extends InvalidInputError {
  constructor() {
    super(
      'identity.profile.unknown_time_zone',
      'Fuso horário desconhecido. Use um nome do formato IANA, como America/Sao_Paulo.',
    );
  }
}

/**
 * The professional may not reach this patient: no active link, no
 * `share_with_professional` consent in force, or both (card I-04).
 *
 * **404 and deliberately not 403**, which is the one place in this file where
 * the status is a security decision and not a description. A 403 would be an
 * oracle: a professional trying patient ids would get "não pode" for the ones
 * that exist and "não existe" for the rest, and that difference alone is a
 * list of the platform's patients. So a patient the caller may not see answers
 * exactly like a patient that is not there, and the reason lives in the log
 * and never in the response (CLAUDE.md, "Saúde e LGPD").
 *
 * The message says nothing either: no name, no practice, no hint of which of
 * the conditions failed.
 */
export class PatientNotFoundError extends NotFoundError {
  constructor() {
    super('identity.patient.not_found', 'Paciente não encontrado.');
  }
}

/**
 * The caller may see this patient and may not prescribe their food: they are
 * not a nutritionist (CLAUDE.md, "Saúde e LGPD" — "só nutricionista edita
 * plano alimentar", checking `professional_type`).
 *
 * 403 and not 404, unlike the error above, and for the same reasoning: whoever
 * gets this already has access to the patient, so there is nothing left to
 * hide from them — they are only being told what their licence does not cover.
 * Without access they get `PatientNotFoundError` and never reach this one.
 */
export class MealPlanRequiresNutritionistError extends PermissionDeniedError {
  constructor() {
    super(
      'identity.meal_plan.nutritionist_required',
      'Só um nutricionista pode editar o plano alimentar.',
    );
  }
}

/**
 * The caller is signed in and has a profile, and it is a professional's: the
 * consents are the patient's own (card I-05).
 *
 * 403 and not 404, the mirror of `CallerIsNotProfessionalError` above: nothing
 * is being looked up, and the person is simply not the subject of this
 * request. A professional who wants to know what a patient consented to asks
 * through the patient's chart, where the access rule answers (ADR 0017) — and
 * nobody consents on somebody else's behalf, which is the whole premise of
 * consent under LGPD.
 */
export class CallerIsNotPatientError extends PermissionDeniedError {
  constructor() {
    super('identity.patient.required', 'Só o próprio paciente pode dar e revogar consentimentos.');
  }
}

/**
 * There is no consent of that purpose in force, so there is nothing to revoke.
 *
 * 409, as `InvitationNotPendingError` is: the request is well formed and the
 * state of the record is what refuses it. Answering 200 instead would tell the
 * patient the platform has just stopped doing something it had already
 * stopped, which is the one thing a consent screen must never be vague about.
 */
export class ConsentNotInForceError extends ConflictError {
  constructor() {
    super(
      'identity.consent.not_in_force',
      'Este consentimento já não está vigente, então não há o que revogar.',
    );
  }
}

/**
 * There is no care link with that id among the patient's own (card I-07).
 *
 * It is also the answer when the link exists and belongs to **another**
 * patient, exactly as `InvitationNotFoundError` is for an invitation of another
 * practice: a patient has no business learning that an id is somebody else's
 * follow-up.
 *
 * The professional's side of the same request never answers this one — it
 * answers `PatientNotFoundError`, because there the thing that was not found is
 * a patient and saying anything else would tell a caller which ids are real.
 */
export class CareRelationshipNotFoundError extends NotFoundError {
  constructor() {
    super('identity.care_relationship.not_found', 'Vínculo de acompanhamento não encontrado.');
  }
}

/**
 * The follow-up was already ended, by this side or by the other one
 * (card I-07).
 *
 * 409, as `ConsentNotInForceError` and `InvitationNotPendingError` are: the
 * request is well formed and the state of the record is what refuses it.
 * Answering 200 instead would date the link a second time, announce a second
 * ending to the other modules, and tell whoever asked that something happened
 * now when it happened a month ago.
 */
export class CareRelationshipAlreadyEndedError extends ConflictError {
  constructor() {
    super(
      'identity.care_relationship.already_ended',
      'Este acompanhamento já foi encerrado, então não há o que encerrar.',
    );
  }
}

/**
 * The `cursor` of `GET /v1/me/access-log` is not one this API minted
 * (card I-06).
 *
 * 400 and not an empty page, which is the tempting answer and the wrong one: a
 * patient paging through who saw their data must never be told "acabou"
 * because a cursor was truncated by a proxy or mistyped by a client. The
 * cursor is opaque and the only correct use of it is to send back what was
 * given, so anything else is a client bug and says so.
 */
export class InvalidAccessLogCursorError extends InvalidInputError {
  constructor() {
    super(
      'identity.access_log.invalid_cursor',
      'Não foi possível continuar a lista a partir daqui. Abra o registro de acessos de novo.',
    );
  }
}

/**
 * The patient is trying to give a purpose that rests on `health_data`, and
 * that one is not in force.
 *
 * 422 and not 400 — the request is well formed and a rule refuses it. It is
 * the other half of "revogar `health_data` encerra o uso do app" (card I-05):
 * every other purpose is something done **to** the health data, so turning one
 * back on without it would have the platform sharing, importing or sending to
 * the AI data it has no permission to keep.
 *
 * The way out is in the message, and it is a single tap: give `health_data`
 * again, and the purposes can be given again one by one.
 */
export class HealthDataConsentRequiredError extends RuleViolationError {
  constructor() {
    super(
      'identity.consent.health_data_required',
      'Para dar este consentimento é preciso concordar primeiro com o uso dos seus dados de saúde.',
    );
  }
}
