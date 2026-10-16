import 'package:dio/dio.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'api_failure.dart';

/// `GET /v1/me`: who is using the app, according to the API.
///
/// The type of the answer is the one from the contract, not a type written
/// here. `autoDispose` is what makes signing out and back in fetch again
/// instead of showing the previous answer: the home screen is the only
/// listener, and it leaves the tree with the session.
final meProvider = FutureProvider.autoDispose<MeResponse>((ref) async {
  try {
    final response = await ref.watch(apiClientProvider).getMeApi().meControllerGetV1();
    final body = response.data;

    if (body == null) {
      throw const ApiFailure(message: 'A API respondeu sem corpo em GET /v1/me.');
    }

    return body;
  } on DioException catch (error) {
    // Rethrown as the failure the screen knows how to read. The `DioException`
    // stops here on purpose: it carries the request, headers included, and the
    // header of this one is the token.
    throw apiFailure(error);
  }
});
