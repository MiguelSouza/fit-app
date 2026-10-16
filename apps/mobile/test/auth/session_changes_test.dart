import 'dart:async';

import 'package:fit_app/src/auth/auth_providers.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

void main() {
  group('SessionChanges', () {
    test('notifies once for each change of the session', () async {
      final changes = StreamController<AuthState>();
      final sessionChanges = SessionChanges(changes.stream);
      var notified = 0;

      sessionChanges.addListener(() => notified++);
      changes.add(const AuthState(AuthChangeEvent.signedIn, null));
      changes.add(const AuthState(AuthChangeEvent.signedOut, null));
      await pumpEventQueue();

      expect(notified, 2);

      sessionChanges.dispose();
      await changes.close();
    });

    test('an error on the stream is handled, and is not a change of session', () async {
      final changes = StreamController<AuthState>();
      final sessionChanges = SessionChanges(changes.stream);
      var notified = 0;

      sessionChanges.addListener(() => notified++);

      // What a token refresh with no network looks like: the Auth client puts
      // it on the stream as an error. A subscription without `onError` lets it
      // out as an unhandled error, which fails this test — and in the app
      // would be printed by Flutter, with the Auth request in it.
      changes.addError(AuthRetryableFetchException(message: 'sem rede'));
      await pumpEventQueue();

      // The session did not change: one that really ended arrives as a
      // `signedOut` event, not as an error.
      expect(notified, 0);

      sessionChanges.dispose();
      await changes.close();
    });
  });
}
