/**
 * Public API of `@fit-app/observability`: what this platform is not allowed to
 * send out about a person, in one place.
 *
 * Two things live here, and they are two halves of the same rule (CLAUDE.md,
 * "Saúde e LGPD"):
 *
 * - the list of sensitive field names, and the masking that uses it, which the
 *   logger of the API runs over every log object (ADR 0006);
 * - the `beforeSend` of the Sentry SDKs, which runs over every error event of
 *   the API, of the panel and — in its Dart twin — of the app (ADR 0013).
 *
 * The package is deliberately dependency free and has no I/O: it is read by a
 * Nest app, by Next.js (in the browser too) and by whoever else needs to
 * decide whether a field may leave. The app of the patient cannot import
 * TypeScript, so it carries the same rules in Dart, in
 * `apps/mobile/lib/src/core/observability/`.
 */
export {
  isSensitiveKey,
  redactSensitive,
  redactSensitiveObject,
  REDACTED,
  TRUNCATED,
} from './sensitive-fields';

export { scrubSentryEvent, urlWithoutQuery, type ScrubbableEvent } from './scrub-event';
