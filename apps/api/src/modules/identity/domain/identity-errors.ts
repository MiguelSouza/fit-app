import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
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
