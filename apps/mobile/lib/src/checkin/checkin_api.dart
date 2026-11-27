import 'package:dio/dio.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/api_failure.dart';
import 'checkin_day.dart';

/// The two calls the check-in screen makes (card P-02).
///
/// Both go through the generated client, so the app builds no URL and types no
/// answer by hand (`CLAUDE.md` rule 7, ADR 0008). Neither one says who the
/// patient is: the API reads that from the `sub` of the verified token
/// (ADR 0007).
///
/// **Nothing here is logged.** Energy, sleep, hunger, symptoms and the note are
/// the patient's health data, and the `DioException` is caught before it can
/// travel — it carries the request, and the body of this one is the check-in
/// itself (`CLAUDE.md`, "Saúde e LGPD").

/// What the screen calls to save. A provider, so a test answers it without a
/// network and so the screen holds no client of its own.
typedef SaveCheckin =
    Future<Checkin> Function({required String day, required RecordCheckinRequest answers});

/// `PUT /v1/me/checkins/{date}`: the check-in of a day, saved or corrected.
///
/// Sending it twice saves one check-in — the day is the address, so a double
/// tap and a retry are the same request (card P-02).
final saveCheckinProvider = Provider<SaveCheckin>((ref) {
  final api = ref.watch(apiClientProvider);

  return ({required String day, required RecordCheckinRequest answers}) async {
    try {
      final response = await api.getMyCheckinsApi().myCheckinsControllerRecordV1(
        date: day,
        recordCheckinRequest: answers,
      );

      final saved = response.data;

      if (saved == null) {
        throw const ApiFailure(message: 'A API respondeu sem corpo ao salvar o check-in.');
      }

      return saved;
    } on DioException catch (error) {
      throw apiFailure(error);
    }
  };
});

/// `GET /v1/me/checkins` for today alone: what the patient already answered, so
/// the screen opens on it instead of on an empty form.
///
/// `null` means the day has no check-in yet, which is not a failure and is the
/// common case before the evening. The period is one day, both ends the same.
///
/// `autoDispose`: the screen is the only listener, and coming back to it should
/// read the day again rather than show what was there an hour ago.
final todayCheckinProvider = FutureProvider.autoDispose<Checkin?>((ref) async {
  final day = checkinDayOf();

  try {
    final response = await ref
        .watch(apiClientProvider)
        .getMyCheckinsApi()
        .myCheckinsControllerListV1(from: day, to: day);

    final checkins = response.data?.checkins;

    if (checkins == null || checkins.isEmpty) return null;

    return checkins.first;
  } on DioException catch (error) {
    throw apiFailure(error);
  }
});
