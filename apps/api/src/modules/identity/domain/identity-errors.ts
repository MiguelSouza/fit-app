import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  PermissionDeniedError,
} from '../../../shared/domain/domain-error';

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
