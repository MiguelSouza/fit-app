import 'package:dio/dio.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../auth/auth_providers.dart';
import '../core/config/app_config_provider.dart';

/// The API client, with the token of the session in every call.
///
/// The app builds no URL and types no response by hand: everything goes
/// through `fit_app_api_client`, generated from the OpenAPI document of the API
/// (rule 7 of `CLAUDE.md`, ADR 0008). A field the API stops answering stops
/// compiling here.
///
/// Passing `interceptors` replaces the four the generator installs (OAuth,
/// basic, bearer, api key), which is what we want: the one below is the only
/// authentication this API has, and the generated bearer interceptor would
/// need the token handed to it up front — a token that is good for an hour.
final apiClientProvider = Provider<FitAppApiClient>((ref) {
  final auth = ref.watch(supabaseAuthProvider);

  return FitAppApiClient(
    basePathOverride: ref.watch(appConfigProvider).apiUrl,
    interceptors: [AccessTokenInterceptor(auth)],
  );
});

/// Puts `Authorization: Bearer <token>` on every request, asking for the token
/// at the moment of the call.
///
/// The token is never stored here. A Supabase access token lasts an hour and
/// the Auth client refreshes it on its own, so reading `currentSession` per
/// request is what sends a valid one — the same reasoning as the panel
/// (`apps/web/src/lib/api/client.ts`). When the stored one is already past its
/// expiry, one refresh is attempted; if that fails the request goes out as it
/// is and the API answers 401, which is the screen's cue to send the person
/// back to the sign in.
///
/// Who verifies the signature is the API, with the global guard of ADR 0007.
/// The app only carries the envelope.
class AccessTokenInterceptor extends Interceptor {
  AccessTokenInterceptor(this._auth);

  final GoTrueClient _auth;

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await _accessToken();

    if (token != null) options.headers['Authorization'] = 'Bearer $token';

    handler.next(options);
  }

  Future<String?> _accessToken() async {
    final session = _auth.currentSession;

    if (session == null) return null;
    if (!session.isExpired) return session.accessToken;

    try {
      final refreshed = await _auth.refreshSession();

      return refreshed.session?.accessToken;
    } on Exception {
      // Nothing to log: the error object of Auth carries the e-mail of the
      // session (`CLAUDE.md`). The 401 that follows says enough.
      return null;
    }
  }
}
