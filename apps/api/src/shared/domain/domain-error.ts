/**
 * Errors the domain raises, with no idea that HTTP exists.
 *
 * A use case throws one of these; the translation to a status code happens in
 * one single place, `shared/presentation/global-exception.filter.ts`, as
 * CLAUDE.md requires under "Convenções". A module may extend them with errors
 * of its own (`PlanNotFoundError extends NotFoundError`).
 */
export type DomainErrorKind =
  'invalid_input' | 'not_found' | 'permission_denied' | 'conflict' | 'rule_violation';

export abstract class DomainError extends Error {
  /** What kind of failure this is. The filter maps it to a status code. */
  abstract readonly kind: DomainErrorKind;

  /**
   * Stable identifier of the error, `<module>.<entity>.<problem>`
   * (`nutrition.plan.not_found`). It is what the panel and the app key their
   * translation off, which is why the message below can change without
   * breaking a client.
   */
  readonly code: string;

  /**
   * @param code stable identifier, in English
   * @param message pt-BR text, ready to be shown to the user. It must not
   *   carry patient data: it travels in the response and the client may log
   *   it. Ids and codes only.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** The request is malformed or the value is unacceptable. */
export class InvalidInputError extends DomainError {
  readonly kind = 'invalid_input';
}

/** The record does not exist, or the caller may not know that it does. */
export class NotFoundError extends DomainError {
  readonly kind = 'not_found';
}

/**
 * No active link, no consent in force, or the wrong professional type
 * (CLAUDE.md, "Saúde e LGPD").
 */
export class PermissionDeniedError extends DomainError {
  readonly kind = 'permission_denied';
}

/** The current state of the record does not allow the operation. */
export class ConflictError extends DomainError {
  readonly kind = 'conflict';
}

/** The input is well formed but a domain rule rejects it. */
export class RuleViolationError extends DomainError {
  readonly kind = 'rule_violation';
}
