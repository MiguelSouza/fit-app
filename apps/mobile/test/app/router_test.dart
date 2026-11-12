import 'package:fit_app/src/app/router.dart';
import 'package:flutter_test/flutter_test.dart';

/// A token the shape of a real one, which opens nothing: 43 characters of
/// `base64url`, as the API issues (ADR 0015).
const String _token = 'abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE';

String? redirectForPath({required bool signedIn, required String location}) =>
    redirectFor(signedIn: signedIn, location: Uri.parse(location));

void main() {
  group('redirectFor', () {
    test('no session: anything but the public routes goes to the sign in', () {
      expect(redirectForPath(signedIn: false, location: homePath), signInPath);
      expect(redirectForPath(signedIn: false, location: '/qualquer-tela-nova'), signInPath);
    });

    test('no session: the sign in itself answers', () {
      expect(redirectForPath(signedIn: false, location: signInPath), isNull);
    });

    test('with a session: the sign in has nothing to show', () {
      expect(redirectForPath(signedIn: true, location: signInPath), homePath);
    });

    test('with a session: the protected routes answer', () {
      expect(redirectForPath(signedIn: true, location: homePath), isNull);
    });

    test('a route nobody listed is protected by not being on the list', () {
      // This is the point of the closed list: forgetting to open a route gives
      // a redirect somebody notices, while a patient screen left open by
      // forgetting does not show up at all.
      expect(publicPaths, <String>[signInPath, invitePath]);
      expect(redirectForPath(signedIn: false, location: '/diario'), signInPath);
    });
  });

  group('the invitation', () {
    test('answers with and without a session, which is the whole of its flow', () {
      // The patient signs up in the middle of it: a redirect to the home at
      // that moment would throw them out one screen before the consents.
      expect(redirectForPath(signedIn: false, location: invitePath), isNull);
      expect(redirectForPath(signedIn: true, location: invitePath), isNull);
      expect(redirectForPath(signedIn: true, location: '$invitePath?token=$_token'), isNull);
    });

    test('the deep link, host and all, lands on the screen', () {
      expect(
        redirectForPath(signedIn: false, location: 'fitapp://convite?token=$_token'),
        '$invitePath?token=$_token',
      );
    });

    test('the same link with the host dropped, as older engines gave it, lands there too', () {
      expect(
        redirectForPath(signedIn: false, location: '/?token=$_token'),
        '$invitePath?token=$_token',
      );
    });

    test('the link of the panel lands there as well', () {
      expect(
        redirectForPath(
          signedIn: false,
          location: 'https://painel.fit-app.com.br/convite?token=$_token',
        ),
        '$invitePath?token=$_token',
      );
    });

    test('a link with no token opens the screen that asks for the code', () {
      expect(redirectForPath(signedIn: false, location: 'fitapp://convite'), invitePath);
    });

    test('a broken token is carried in, to be refused with a message', () {
      // The screen is what says "link inválido": a redirect that dropped it
      // would open an empty field and let the person guess.
      expect(
        redirectForPath(signedIn: false, location: 'fitapp://convite?token=curto'),
        '$invitePath?token=curto',
      );
    });
  });
}
