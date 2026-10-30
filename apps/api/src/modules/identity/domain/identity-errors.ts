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
