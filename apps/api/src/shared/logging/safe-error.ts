/**
 * An error reduced to what is safe to log.
 *
 * The message is dropped on purpose. An unexpected error is often the database
 * driver's, and a Postgres message quotes the value that broke the query
 * ("Key (email)=(...) already exists"), which is personal data and never goes
 * to a log (CLAUDE.md, "Saúde e LGPD"). The type, the driver's code and the
 * stack say where it broke, which is what debugging needs.
 */
export interface SafeError {
  readonly type: string;
  readonly code?: string;
  readonly stack?: string;
}

/**
 * Everything the stack trace says minus its first line, which repeats the
 * message.
 */
export function stackWithoutMessage(error: Error): string {
  return (error.stack ?? '').split('\n').slice(1).join('\n');
}

/** Shapes anything thrown — an `Error` or not — into `SafeError`. */
export function toSafeError(thrown: unknown): SafeError {
  if (!(thrown instanceof Error)) {
    return { type: `non-error (${typeof thrown})` };
  }

  const code = (thrown as { code?: unknown }).code;

  return {
    type: thrown.name,
    ...(typeof code === 'string' ? { code } : {}),
    stack: stackWithoutMessage(thrown),
  };
}
