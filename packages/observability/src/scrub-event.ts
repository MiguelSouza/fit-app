import { REDACTED, redactSensitiveObject } from './sensitive-fields';

/**
 * The `beforeSend` of every Sentry SDK of this platform: what is left of an
 * event after everything that could be personal or health data is taken out
 * of it.
 *
 * Why a filter of our own, when the SDK already has options for this: the
 * options say which categories to collect, and this says what an event is
 * allowed to carry whatever collected it. The two are layers of the same wall
 * — `dataCollection` keeps the SDK from picking the data up (see
 * `apps/api/src/shared/observability/sentry.ts`), and this runs last, on the
 * event as it is about to leave the process, so a field that arrived through
 * an integration nobody foresaw still does not go out.
 *
 * The rules, and the reason for each one:
 *
 * - **The user is an id and nothing else.** Sentry shows an e-mail and a
 *   username next to every issue if it has them; this platform has no reason
 *   to put a patient's name in a bug tracker (CLAUDE.md, "Saúde e LGPD": log
 *   ids and codes).
 * - **The request keeps its method and its path.** The body is whatever the
 *   panel or the app sent — a check-in, a note, a meal — the cookies and the
 *   headers carry the session token, and the query string is where a search
 *   box puts whatever was typed, which is usually somebody's name.
 * - **Free text is masked.** An error message is written by whoever threw it,
 *   including a database driver, and a Postgres message quotes the value that
 *   broke the query ("Key (email)=(...) already exists"). Same reasoning as
 *   `safe-error.ts` in the API: the type, the stack and the code say where it
 *   broke, which is what debugging needs.
 * - **Stack frames keep their code and lose their variables.** The source
 *   lines around the failure are ours; the locals at that point are the
 *   patient's.
 * - **Breadcrumbs keep the trail and lose the content.** Which screen, which
 *   request, which status code — not what a `console.log` printed nor what the
 *   element that was clicked had written on it.
 * - **Everything else is masked by field name**, by the same list the log
 *   lines go through (`sensitive-fields.ts`).
 *
 * The event is modified in place and returned, which is what a `beforeSend`
 * is expected to do, and what keeps every field the SDK added and we did not
 * think about.
 */

/**
 * The part of a Sentry event this filter touches, declared structurally.
 *
 * Deliberately not `Event` from `@sentry/core`: this package would then have
 * to depend on a Sentry SDK, pick a version, and be built against the browser
 * one or the Node one. Written this way, the same function serves
 * `@sentry/node` in the API and `@sentry/nextjs` in the panel, and the
 * compiler checks at each call site that the SDK's event still fits — a field
 * that changes shape in a future version breaks the build instead of leaking.
 */
export interface ScrubbableEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  request?: {
    url?: string;
    method?: string;
    data?: unknown;
    query_string?: unknown;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    env?: Record<string, string>;
  };
  user?: { id?: string | number };
  exception?: { values?: ScrubbableException[] };
  breadcrumbs?: ScrubbableBreadcrumb[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

interface ScrubbableException {
  value?: string;
  stacktrace?: { frames?: ScrubbableFrame[] };
}

interface ScrubbableFrame {
  vars?: Record<string, unknown>;
}

interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Breadcrumb categories dropped whole, because the crumb *is* the content:
 * a `console` crumb is the text somebody printed.
 */
const DROPPED_BREADCRUMB_CATEGORIES = new Set(['console']);

/** Breadcrumb data fields that say what happened without saying to whom. */
const SAFE_BREADCRUMB_DATA = new Set([
  'method',
  'status_code',
  'reason',
  'duration',
  'request_body_size',
  'response_body_size',
]);

/** The same, for the fields that hold an address: kept, minus the query string. */
const URL_BREADCRUMB_DATA = new Set(['url', 'from', 'to']);

/**
 * An address without the part that carries data: the query string, the
 * fragment and the `user:password@` some clients put in front of the host.
 * The path survives, ids and all — `/v1/patients/pat_7/check-ins` is what
 * makes an issue readable.
 */
export function urlWithoutQuery(url: string): string {
  const [withoutFragment] = url.split('#');
  const [withoutQuery] = (withoutFragment ?? url).split('?');

  return (withoutQuery ?? url).replace(/\/\/[^/@]*@/, '//');
}

/**
 * Takes a Sentry event and gives back the same event, scrubbed.
 *
 * Generic so the SDK's own event type comes out the other side: `beforeSend`
 * has to return the `ErrorEvent` it was given, not a widened copy of it.
 */
export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E {
  scrubUser(event);
  scrubRequest(event);
  scrubFreeText(event);
  scrubBreadcrumbs(event);
  scrubContainers(event);

  return event;
}

function scrubUser(event: ScrubbableEvent): void {
  if (event.user === undefined) return;

  const { id } = event.user;

  // An event with no id to pin the user on is an anonymous event, which is
  // better than one carrying an e-mail the SDK found somewhere.
  if (id === undefined) delete event.user;
  else event.user = { id };
}

function scrubRequest(event: ScrubbableEvent): void {
  const { request } = event;

  if (request === undefined) return;

  delete request.data;
  delete request.cookies;
  delete request.headers;
  delete request.query_string;
  delete request.env;

  if (request.url !== undefined) request.url = urlWithoutQuery(request.url);
}

function scrubFreeText(event: ScrubbableEvent): void {
  if (event.message !== undefined) event.message = REDACTED;

  if (event.logentry !== undefined) {
    event.logentry = { message: REDACTED };
  }

  for (const exception of event.exception?.values ?? []) {
    // The type of the exception is left alone: `TypeError` is not data about
    // anybody, and it is half of what Sentry titles the issue with.
    if (exception.value !== undefined) exception.value = REDACTED;

    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
    }
  }
}

function scrubBreadcrumbs(event: ScrubbableEvent): void {
  if (event.breadcrumbs === undefined) return;

  const kept = event.breadcrumbs.filter(
    (breadcrumb) => !DROPPED_BREADCRUMB_CATEGORIES.has(breadcrumb.category ?? ''),
  );

  for (const breadcrumb of kept) {
    // Which element was clicked comes out as a description of it, and in this
    // interface an element is often labelled with a patient's name.
    delete breadcrumb.message;

    if (breadcrumb.data !== undefined) breadcrumb.data = safeBreadcrumbData(breadcrumb.data);
  }

  event.breadcrumbs = kept;
}

/** An allow list, not a deny list: a crumb's data is whatever produced it. */
function safeBreadcrumbData(data: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (URL_BREADCRUMB_DATA.has(key) && typeof value === 'string') {
      safe[key] = urlWithoutQuery(value);
    } else if (SAFE_BREADCRUMB_DATA.has(key)) {
      safe[key] = value;
    }
  }

  return safe;
}

/**
 * The three bags an event carries that we and the SDK both write into. They
 * go through the same field name masking as a log line, which is what keeps a
 * context somebody adds next year from having to remember this file.
 */
function scrubContainers(event: ScrubbableEvent): void {
  if (event.extra !== undefined) event.extra = redactSensitiveObject(event.extra);
  if (event.contexts !== undefined) event.contexts = redactSensitiveObject(event.contexts);
  if (event.tags !== undefined) event.tags = redactSensitiveObject(event.tags);
}
