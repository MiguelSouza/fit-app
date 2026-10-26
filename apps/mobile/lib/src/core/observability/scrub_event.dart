import 'package:sentry_flutter/sentry_flutter.dart';

import 'sensitive_fields.dart';

/// The `beforeSend` of the app: what is left of an event after everything that
/// could be personal or health data is taken out of it.
///
/// The Dart twin of `packages/observability/src/scrub-event.ts`, which the API
/// and the panel use, with the same rules and for the same reasons:
///
/// - **The user is an id and nothing else.** Sentry shows an e-mail and a
///   username next to every issue if it has them; a patient has no business in
///   a bug tracker (`CLAUDE.md`, "Saúde e LGPD").
/// - **The request keeps its method and its path.** The body is what the app
///   sent — a check-in, a note — the headers carry the session token, and the
///   query string is where a search box puts what was typed.
/// - **Free text is masked.** The message of an error is written by whoever
///   threw it, and what the API answers in it can quote a value.
/// - **Breadcrumbs keep the trail and lose the content.** Which screen, which
///   request, which status code — not what was tapped, which on this app is
///   often a label with somebody's name in it.
/// - **Everything else is masked by field name**, by the same list as the
///   lines of the API (`sensitive_fields.dart`, next door).
///
/// The event is modified in place and returned, which is what a `beforeSend`
/// is expected to do and what keeps every field the SDK added and we did not
/// think about.
///
/// Stack frames are not touched here, unlike in the TypeScript twin: Dart does
/// not capture the local variables of a frame, so there are none to drop.
SentryEvent scrubSentryEvent(SentryEvent event) {
  _scrubUser(event);
  _scrubRequest(event);
  _scrubFreeText(event);
  _scrubBreadcrumbs(event);
  _scrubContainers(event);

  return event;
}

/// Breadcrumb categories dropped whole, because the crumb *is* the content.
const Set<String> _droppedBreadcrumbCategories = <String>{'console'};

/// Breadcrumb data that says what happened without saying to whom.
const Set<String> _safeBreadcrumbData = <String>{
  'method',
  'status_code',
  'reason',
  'duration',
  'request_body_size',
  'response_body_size',
};

/// The same, for the fields that hold an address: kept, minus the query.
const Set<String> _urlBreadcrumbData = <String>{'url', 'from', 'to'};

final RegExp _credentialsInUrl = RegExp('//[^/@]*@');

/// An address without the parts that carry data: the query string, the
/// fragment and the `user:password@` in front of the host. The path survives,
/// ids and all — `/v1/patients/pat_7/check-ins` is what makes an issue
/// readable.
String urlWithoutQuery(String url) {
  final String withoutFragment = url.split('#').first;
  final String withoutQuery = withoutFragment.split('?').first;

  return withoutQuery.replaceFirst(_credentialsInUrl, '//');
}

void _scrubUser(SentryEvent event) {
  final SentryUser? user = event.user;

  if (user == null) return;

  final String? id = user.id;

  // An event with no id to pin the user on is an anonymous event, which is
  // better than one carrying an e-mail the SDK found somewhere.
  event.user = id == null ? null : SentryUser(id: id);
}

void _scrubRequest(SentryEvent event) {
  final SentryRequest? request = event.request;

  if (request == null) return;

  final String? url = request.url;

  // A new request and not a cleaned up one: `data`, `headers` and `env` have
  // no setters, so what is built here is exactly what may go.
  event.request = SentryRequest(
    url: url == null ? null : urlWithoutQuery(url),
    method: request.method,
  );
}

void _scrubFreeText(SentryEvent event) {
  if (event.message != null) event.message = SentryMessage(redacted);

  for (final SentryException exception in event.exceptions ?? const <SentryException>[]) {
    // The type is left alone: `StateError` is not data about anybody, and it
    // is half of what Sentry titles the issue with.
    if (exception.value != null) exception.value = redacted;
  }
}

void _scrubBreadcrumbs(SentryEvent event) {
  final List<Breadcrumb>? breadcrumbs = event.breadcrumbs;

  if (breadcrumbs == null) return;

  final List<Breadcrumb> kept = <Breadcrumb>[];

  for (final Breadcrumb breadcrumb in breadcrumbs) {
    if (_droppedBreadcrumbCategories.contains(breadcrumb.category ?? '')) continue;

    // What was tapped comes out as a description of the widget, and in this
    // app a widget is often labelled with what the patient wrote.
    breadcrumb.message = null;

    final Map<String, dynamic>? data = breadcrumb.data;
    if (data != null) breadcrumb.data = _safeDataOf(data);

    kept.add(breadcrumb);
  }

  event.breadcrumbs = kept;
}

/// An allow list, not a deny list: the data of a crumb is whatever produced it.
Map<String, dynamic> _safeDataOf(Map<String, dynamic> data) {
  final Map<String, dynamic> safe = <String, dynamic>{};

  data.forEach((String key, dynamic value) {
    if (_urlBreadcrumbData.contains(key) && value is String) {
      safe[key] = urlWithoutQuery(value);
    } else if (_safeBreadcrumbData.contains(key)) {
      safe[key] = value;
    }
  });

  return safe;
}

/// The bags an event carries that we and the SDK both write into. They go
/// through the same field name mask as everything else, which is what keeps a
/// context somebody adds next year from having to remember this file.
void _scrubContainers(SentryEvent event) {
  // ignore: deprecated_member_use
  final Map<String, dynamic>? extra = event.extra;

  if (extra != null) {
    // Deprecated in the SDK in favour of contexts, and nothing in this app
    // writes it — which is exactly why it is masked and not skipped: what
    // would end up here is something nobody decided to put here.
    // ignore: deprecated_member_use
    event.extra = redactSensitiveMap(extra);
  }

  final Map<String, String>? tags = event.tags;

  if (tags != null) {
    event.tags = tags.map(
      (String key, String value) =>
          MapEntry<String, String>(key, isSensitiveKey(key) ? redacted : value),
    );
  }

  final Contexts contexts = event.contexts;

  for (final String key in contexts.keys.toList()) {
    final dynamic value = contexts[key];

    if (isSensitiveKey(key)) {
      contexts[key] = redacted;
    } else if (value is Map || value is List) {
      // Only what we or somebody else put there as plain data. The typed
      // contexts of the SDK (`device`, `app`, `os`) are left alone: walking
      // into one would cost it the `toJson` that knows how to write it.
      contexts[key] = redactSensitive(value);
    }
  }
}
