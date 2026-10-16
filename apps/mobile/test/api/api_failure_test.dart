import 'package:dio/dio.dart';
import 'package:fit_app/src/api/api_failure.dart';
import 'package:flutter_test/flutter_test.dart';

/// The envelope of the API, as it arrives: already decoded json, which is what
/// `dio` hands over in `response.data`.
Map<String, Object?> envelope(String code, String message) => <String, Object?>{
  'error': <String, Object?>{'code': code, 'message': message},
};

DioException exception({int? status, Object? body}) {
  final request = RequestOptions(path: '/v1/me');

  return DioException(
    requestOptions: request,
    response: status == null
        ? null
        : Response<Object?>(requestOptions: request, statusCode: status, data: body),
  );
}

void main() {
  group('apiFailure', () {
    test('reads the code and the message of the envelope', () {
      final failure = apiFailure(
        exception(status: 403, body: envelope('identity.access.denied', 'Acesso não permitido.')),
      );

      expect(failure.code, 'identity.access.denied');
      expect(failure.message, 'Acesso não permitido.');
      expect(failure.unauthorized, isFalse);
    });

    test('marks a 401 so the screen can send the person back to the sign in', () {
      final failure = apiFailure(
        exception(
          status: 401,
          body: envelope('auth.unauthorized', 'Sessão inválida ou expirada. Entre novamente.'),
        ),
      );

      expect(failure.unauthorized, isTrue);
      expect(failure.message, 'Sessão inválida ou expirada. Entre novamente.');
    });

    test('a body that is not the envelope gets the generic text, not the body', () {
      final failure = apiFailure(exception(status: 502, body: '<html>Bad Gateway</html>'));

      expect(failure.code, isNull);
      expect(failure.message, contains('Não foi possível falar com a API'));
      expect(failure.message, isNot(contains('Bad Gateway')));
    });

    test('a 401 without an envelope is still a 401', () {
      final failure = apiFailure(exception(status: 401));

      expect(failure.unauthorized, isTrue);
      expect(failure.code, isNull);
    });

    test('an answer that never came has no status to read', () {
      final failure = apiFailure(exception());

      expect(failure.unauthorized, isFalse);
      expect(failure.message, contains('Não foi possível falar com a API'));
    });
  });
}
