import 'package:fit_app/src/core/observability/scrub_event.dart';
import 'package:fit_app/src/core/observability/sensitive_fields.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

/// The second acceptance criterion of card F-16 — *teste prova que dados
/// sensíveis não saem no evento* — for the app.
///
/// It runs against the real `SentryEvent` of the SDK and reads what
/// `toJson()` would put on the wire, so a field the filter forgot shows up
/// here and not in a Sentry issue. The twin of this test, for the API and the
/// panel, is `apps/api/src/shared/observability/sentry.spec.ts`.
///
/// Every value is synthetic (`CLAUDE.md`, "Testes").
const String _name = 'Ana Souza';
const String _email = 'ana.souza@example.com';
const String _phone = '+5511999998888';
const String _note = 'dormiu mal e acordou com dor no joelho';
const String _token = 'eyJhbGciOiJIUzI1NiJ9.synthetic.token';

const List<String> _personal = <String>[_name, _email, _phone, _note, _token];

const String _userId = 'c0ffee00-0000-4000-8000-000000000001';

void main() {
  group('isSensitiveKey', () {
    test('recognizes the fields of the card, however they are spelled', () {
      for (final String key in <String>[
        'name',
        'Name',
        'full_name',
        'patientName',
        'email',
        'contact_email',
        'contact',
        'phone',
        'token',
        'accessToken',
        'notes',
        'checkInWeight',
        'lastCheckIn',
        'weight',
        'mood',
      ]) {
        expect(isSensitiveKey(key), isTrue, reason: key);
      }
    });

    test('leaves ids, codes and timings alone, which is what a report is for', () {
      for (final String key in <String>[
        'patientId',
        'planId',
        'code',
        'status',
        'statusCode',
        'durationMs',
        'method',
        'path',
        'correlationId',
      ]) {
        expect(isSensitiveKey(key), isFalse, reason: key);
      }
    });
  });

  group('redactSensitive', () {
    test('masks a sensitive field wherever it sits, including inside a list', () {
      final Object? redactedValue = redactSensitive(<String, dynamic>{
        'patientId': 'pat_1',
        'records': <dynamic>[
          <String, dynamic>{'id': 'ci_1', 'notes': _note, 'mood': 2},
        ],
      });

      expect(redactedValue, <String, dynamic>{
        'patientId': 'pat_1',
        'records': <dynamic>[
          <String, dynamic>{'id': 'ci_1', 'notes': redacted, 'mood': redacted},
        ],
      });
    });
  });

  group('urlWithoutQuery', () {
    test('keeps the path and drops the query, the fragment and the credentials', () {
      expect(
        urlWithoutQuery('https://api.fit-app.example/v1/patients/pat_7?busca=Ana#topo'),
        'https://api.fit-app.example/v1/patients/pat_7',
      );
      expect(
        urlWithoutQuery('https://user:senha@api.fit-app.example/v1/me'),
        'https://api.fit-app.example/v1/me',
      );
    });
  });

  group('scrubSentryEvent', () {
    test('keeps the user as an id and nothing else', () {
      final SentryEvent event = scrubSentryEvent(
        SentryEvent(user: SentryUser(id: _userId, email: _email, username: _name)),
      );

      expect(event.user?.id, _userId);
      expect(event.user?.email, isNull);
      expect(event.user?.username, isNull);
    });

    test('drops a user with no id rather than sending what is left of it', () {
      final SentryEvent event = scrubSentryEvent(
        SentryEvent(user: SentryUser(ipAddress: '203.0.113.7', username: _name)),
      );

      expect(event.user, isNull);
    });

    test('strips the request down to its method and its path', () {
      final SentryEvent event = scrubSentryEvent(
        SentryEvent(
          request: SentryRequest(
            method: 'POST',
            url: 'https://api.fit-app.example/v1/check-ins?busca=Ana',
            queryString: 'busca=Ana',
            data: <String, dynamic>{'notes': _note},
            headers: <String, String>{'Authorization': 'Bearer $_token'},
          ),
        ),
      );

      expect(event.request?.method, 'POST');
      expect(event.request?.url, 'https://api.fit-app.example/v1/check-ins');
      expect(event.request?.queryString, isNull);
      expect(event.request?.data, isNull);
      expect(event.request?.headers ?? <String, String>{}, isEmpty);
    });

    test('masks free text, and keeps the type of the exception', () {
      final SentryEvent event = scrubSentryEvent(
        SentryEvent(
          message: SentryMessage('falha ao salvar o check-in de $_name'),
          exceptions: <SentryException>[
            SentryException(type: 'StateError', value: 'duplicado: $_email'),
          ],
        ),
      );

      expect(event.message?.formatted, redacted);
      expect(event.exceptions?.first.type, 'StateError');
      expect(event.exceptions?.first.value, redacted);
    });

    test('keeps the trail of the breadcrumbs and throws away their content', () {
      final SentryEvent event = scrubSentryEvent(
        SentryEvent(
          breadcrumbs: <Breadcrumb>[
            Breadcrumb(category: 'console', message: _note),
            Breadcrumb(
              category: 'http',
              message: 'POST /v1/check-ins',
              data: <String, dynamic>{
                'method': 'POST',
                'status_code': 500,
                'url': 'https://api.fit-app.example/v1/patients?busca=Ana',
                'body': _note,
              },
            ),
          ],
        ),
      );

      expect(event.breadcrumbs, hasLength(1));

      final Breadcrumb breadcrumb = event.breadcrumbs!.first;

      expect(breadcrumb.category, 'http');
      expect(breadcrumb.message, isNull);
      expect(breadcrumb.data, <String, dynamic>{
        'method': 'POST',
        'status_code': 500,
        'url': 'https://api.fit-app.example/v1/patients',
      });
    });

    test('masks by field name whatever was put in the tags and the contexts', () {
      final Contexts contexts = Contexts();
      contexts['paciente'] = <String, dynamic>{'id': 'pat_7', 'email': _email};

      final SentryEvent event = scrubSentryEvent(
        SentryEvent(
          contexts: contexts,
          tags: <String, String>{'patientName': _name, 'route': '/inicio'},
        ),
      );

      expect(event.tags, <String, String>{'patientName': redacted, 'route': '/inicio'});
      expect(event.contexts['paciente'], <String, dynamic>{'id': 'pat_7', 'email': redacted});
    });

    test('lets none of it reach the wire, by any route', () {
      final Contexts contexts = Contexts();
      contexts['paciente'] = <String, dynamic>{'name': _name, 'phone': _phone};

      final SentryEvent scrubbed = scrubSentryEvent(
        SentryEvent(
          message: SentryMessage('falha ao salvar o check-in de $_name'),
          user: SentryUser(id: _userId, email: _email, username: _name),
          contexts: contexts,
          tags: <String, String>{'patientPhone': _phone},
          exceptions: <SentryException>[
            SentryException(type: 'StateError', value: 'duplicado: $_email'),
          ],
          breadcrumbs: <Breadcrumb>[Breadcrumb(category: 'console', message: _note)],
          request: SentryRequest(
            method: 'POST',
            url: 'https://api.fit-app.example/v1/check-ins?nome=Ana',
            data: <String, dynamic>{'notes': _note},
            headers: <String, String>{'Authorization': 'Bearer $_token'},
          ),
        ),
      );

      final String json = scrubbed.toJson().toString();

      for (final String value in _personal) {
        expect(json, isNot(contains(value)), reason: value);
      }

      // And the one thing that does go out: who it happened to, as an id.
      expect(json, contains(_userId));
    });
  });
}
