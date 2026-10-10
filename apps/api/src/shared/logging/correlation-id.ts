import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * The id that ties every log line of one request together, and the only thing
 * worth quoting in a support conversation: it says nothing about the patient,
 * so it can travel by e-mail or sit in a ticket.
 *
 * It is kept in an `AsyncLocalStorage` instead of being passed down through
 * every signature: a use case has no business knowing about the request that
 * started it, and the logger reads the current id by itself.
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

const storage = new AsyncLocalStorage<string>();

/**
 * What a caller is allowed to send in: plain, short and without anything that
 * could be read as a log field or a terminal escape. Anything else is ignored
 * rather than sanitized — this value is repeated in every line of the request,
 * and a client that sends junk gets an id of our own.
 */
const ACCEPTABLE = /^[A-Za-z0-9._-]{8,64}$/;

export function newCorrelationId(): string {
  return randomUUID();
}

/**
 * The id to use for a request: the one the caller sent, when it is acceptable,
 * so a trace started at the panel or at the app keeps its name across the hop.
 * Otherwise a fresh one.
 */
export function readCorrelationId(raw: unknown): string {
  const candidate = Array.isArray(raw) ? raw[0] : raw;

  if (typeof candidate === 'string' && ACCEPTABLE.test(candidate)) {
    return candidate;
  }

  return newCorrelationId();
}

/** Runs `work` — and everything it awaits — with `correlationId` in scope. */
export function runWithCorrelationId<T>(correlationId: string, work: () => T): T {
  return storage.run(correlationId, work);
}

/** The id of the request in flight, or `undefined` outside of one (a job, the bootstrap). */
export function currentCorrelationId(): string | undefined {
  return storage.getStore();
}
