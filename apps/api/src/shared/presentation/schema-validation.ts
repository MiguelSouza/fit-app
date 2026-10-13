import {
  StandardSchemaValidationPipe,
  type StandardSchemaValidationPipeOptions,
} from '@nestjs/common';

import { InvalidInputError } from '../domain/domain-error';

/**
 * The issues a schema reports, as the pipe hands them over.
 *
 * Read off the pipe's own option type on purpose: `@standard-schema/spec` is a
 * dependency of NestJS, not one of ours, and this keeps it that way.
 */
type SchemaIssues = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>
>[0];

/** Code every rejected request answers with. The client keys its i18n off it. */
export const INVALID_REQUEST_CODE = 'api.request.invalid';

/**
 * Which fields the schema complained about, as the client spells them
 * (`meals.0.foodId`). Issues without a path — the body is not an object at
 * all — contribute nothing.
 */
function fieldsOf(issues: SchemaIssues): string[] {
  const fields = issues.map((issue) =>
    (issue.path ?? [])
      .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
      .join('.'),
  );

  return [...new Set(fields.filter((field) => field !== ''))];
}

/**
 * Turns what the schema refused into the API's own error, so a malformed
 * request comes out of the global filter in the same envelope as every other
 * failure (`{ error: { code, message } }`) instead of in NestJS's.
 *
 * The body carries the **names** of the offending fields and never a value:
 * the message travels in the response and the client may log it, and a value
 * is where the patient's data is (CLAUDE.md, "Saúde e LGPD"). The issue texts
 * from the schema are dropped for the same reason — and because they are in
 * English, while the message is shown to a user.
 */
export function invalidRequest(issues: SchemaIssues): InvalidInputError {
  const fields = fieldsOf(issues);

  return new InvalidInputError(
    INVALID_REQUEST_CODE,
    fields.length > 0
      ? `Requisição inválida. Revise: ${fields.join(', ')}.`
      : 'Requisição inválida.',
  );
}

/**
 * The pipe every route runs its input through: it validates whatever a
 * `@Body`, `@Query` or `@Param` declares a schema for, against that schema
 * (CLAUDE.md rule 7 — the schema comes from `@fit-app/contracts`).
 *
 * `transform` stays on, which is the default: what reaches the handler is the
 * value the schema produced, with the unknown keys already dropped and the
 * coercions already applied. A route that declares no schema is untouched.
 */
export function createSchemaValidationPipe(): StandardSchemaValidationPipe {
  return new StandardSchemaValidationPipe({ exceptionFactory: invalidRequest });
}
