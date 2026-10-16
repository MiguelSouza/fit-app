import 'package:dio/dio.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';

/// A call that did not work out, in the two pieces a screen needs: whether to
/// send the person back to the sign in, and what to put on the screen.
///
/// Every error of the API comes in the same envelope,
/// `{ "error": { "code", "message" } }`, where `code` is the stable identifier
/// (`nutrition.plan.not_found`) and `message` already arrives in pt-BR, ready
/// to display, and is guaranteed by the contract to carry no patient data —
/// which is why it can go straight to the screen.
class ApiFailure implements Exception {
  const ApiFailure({required this.message, this.code, this.unauthorized = false});

  /// pt-BR, from the API when it answered, from here when it did not.
  final String message;

  /// The stable code of the envelope, when there was one. It is the i18n key.
  final String? code;

  /// The API refused the token: the session is gone or no good any more, and
  /// the screen's move is the sign in.
  final bool unauthorized;

  @override
  String toString() => 'ApiFailure(${code ?? 'sem código'})';
}

/// The one text for "we could not talk to the API", used when there is no
/// envelope to read: a timeout, a refused connection, a 502 from the load
/// balancer, a body that is not what the contract says.
const String _unreachable = 'Não foi possível falar com a API agora. Tente novamente em instantes.';

/// Turns what `dio` throws into an [ApiFailure].
///
/// The envelope is read with the **generated** serializer, not by hand: the
/// shape of an error is part of the contract like any other response
/// (`packages/contracts`), and a body that does not fit it is not an error
/// message — it is something else answering, and gets the generic text.
ApiFailure apiFailure(DioException error) {
  final response = error.response;
  final status = response?.statusCode;

  if (status == null) return const ApiFailure(message: _unreachable);

  final envelope = _envelope(response?.data);

  if (envelope == null) {
    return ApiFailure(message: _unreachable, unauthorized: status == 401);
  }

  return ApiFailure(
    message: envelope.error.message,
    code: envelope.error.code,
    unauthorized: status == 401,
  );
}

ErrorResponse? _envelope(Object? data) {
  if (data == null) return null;

  try {
    return standardSerializers.deserializeWith(ErrorResponse.serializer, data);
  } on Object {
    // A body that is not the envelope. Not logged: at this point nobody knows
    // what is in it, and an API that answers patient data must not have it
    // copied into a log line (`CLAUDE.md`).
    return null;
  }
}
