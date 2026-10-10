/**
 * What never reaches a log line, masked automatically before the logger
 * serializes anything.
 *
 * CLAUDE.md ("Saúde e LGPD") is blunt about it: no health data and no personal
 * data in a log — not in CloudWatch, not in Sentry, not in Langfuse. Ids and
 * codes, yes. Leaving that to whoever writes the log call means it works until
 * someone logs a whole entity by accident, so the rule lives here instead, in
 * front of the serializer.
 *
 * Matching is by field name, and it errs on the side of masking: a `filename`
 * that comes out as `[redacted]` costs an inconvenience, an e-mail address that
 * comes out in full is a breach.
 */
export const REDACTED = '[redacted]';

/** Deeper than this, a value is cut instead of walked. Also what stops a cycle. */
const MAX_DEPTH = 8;

export const TRUNCATED = '[truncated]';

/**
 * Field names that are masked whole. Normalized: lower case, without `_`, `-`
 * or spaces, so `check_in`, `checkIn` and `CHECK-IN` are the same name.
 */
const SENSITIVE_NAMES = new Set([
  // Who the person is (card F-06: nome, e-mail, telefone)
  'name',
  'email',
  'mail',
  'phone',
  'mobile',
  'whatsapp',
  'cpf',
  'birthdate',
  'dateofbirth',
  'dob',
  'address',
  // Credentials (card F-06: token)
  'token',
  'authorization',
  'cookie',
  'password',
  'secret',
  'apikey',
  // What the patient wrote or reported (card F-06: notas, valores de check-in)
  'notes',
  'note',
  'observations',
  'weight',
  'height',
  'bodyfat',
  'mood',
  'energy',
  'pain',
  'symptom',
  'symptoms',
  'measures',
  'measurements',
  'sleephours',
]);

/**
 * Suffixes, for the same fields spelled with a qualifier in front:
 * `patientName`, `contactEmail`, `accessToken`, `professional_phone`.
 */
const SENSITIVE_SUFFIXES = [
  'name',
  'email',
  'phone',
  'token',
  'secret',
  'password',
  'notes',
  'note',
  'cpf',
  'birthdate',
  'address',
  'apikey',
];

/** Prefixes, which is how a check-in field is usually written: `checkInWeight`. */
const SENSITIVE_PREFIXES = ['checkin'];

function normalize(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isSensitiveKey(key: string): boolean {
  const name = normalize(key);

  return (
    SENSITIVE_NAMES.has(name) ||
    SENSITIVE_SUFFIXES.some((suffix) => name.endsWith(suffix)) ||
    SENSITIVE_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/**
 * Objects that carry their own serialization and are walked around, not into:
 * a `Date` would lose its `toJSON`, an `Error` its stack, and a `Buffer` would
 * turn into a thousand numbered keys.
 *
 * An error's own message is handled by the logger's `err` serializer, which
 * drops it — a driver message quotes the value that broke the query.
 */
function isWalkable(value: object): boolean {
  return !(
    value instanceof Date ||
    value instanceof Error ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    ArrayBuffer.isView(value)
  );
}

function walk(value: unknown, depth: number): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (!isWalkable(value)) return value;

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSensitiveKey(key) ? REDACTED : walk(item, depth + 1);
  }

  return result;
}

/**
 * A copy of `value` with every sensitive field replaced by `REDACTED`, at any
 * depth and through arrays. Pure: the object it is given is not touched.
 */
export function redactSensitive(value: unknown): unknown {
  return walk(value, 0);
}

/** Same thing, typed for pino's `formatters.log`, which hands over the log object. */
export function redactSensitiveObject(object: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(object)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED : walk(value, 1);
  }

  return redacted;
}
