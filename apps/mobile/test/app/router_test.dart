import 'package:fit_app/src/app/router.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('redirectFor', () {
    test('no session: anything but the public routes goes to the sign in', () {
      expect(redirectFor(signedIn: false, location: homePath), signInPath);
      expect(redirectFor(signedIn: false, location: '/qualquer-tela-nova'), signInPath);
    });

    test('no session: the sign in itself answers', () {
      expect(redirectFor(signedIn: false, location: signInPath), isNull);
    });

    test('with a session: the sign in has nothing to show', () {
      expect(redirectFor(signedIn: true, location: signInPath), homePath);
    });

    test('with a session: the protected routes answer', () {
      expect(redirectFor(signedIn: true, location: homePath), isNull);
    });

    test('a route nobody listed is protected by not being on the list', () {
      // This is the point of the closed list: forgetting to open a route gives
      // a redirect somebody notices, while a patient screen left open by
      // forgetting does not show up at all.
      expect(publicPaths, <String>[signInPath]);
      expect(redirectFor(signedIn: false, location: '/diario'), signInPath);
    });
  });
}
