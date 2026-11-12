import 'package:fit_app/src/invitation/invitation_link.dart';
import 'package:flutter_test/flutter_test.dart';

/// A token the shape of a real one: 43 characters of `base64url`, which is
/// what the API issues (ADR 0015). It opens no invitation — it is a label.
const String _token = 'abcdefghijklmnopqrstuvwxyz0123456789-_ABCDE';

void main() {
  group('isInvitationLink', () {
    test('the link as iOS delivers it: the whole address, host and all', () {
      expect(isInvitationLink(Uri.parse('fitapp://convite?token=$_token')), isTrue);
    });

    test('the link as Android delivers it: the path and the query, no host', () {
      // `fitapp://convite?token=...` reaches the engine as this, which is the
      // whole reason the token in the query is what identifies the link.
      expect(isInvitationLink(Uri.parse('/?token=$_token')), isTrue);
    });

    test('the link of the panel, which is the one the professional sends', () {
      expect(
        isInvitationLink(Uri.parse('https://painel.fit-app.com.br/convite?token=$_token')),
        isTrue,
      );
    });

    test('the screen opened by hand, with no token yet', () {
      expect(isInvitationLink(Uri.parse('/convite')), isTrue);
    });

    test('anything else is not an invitation', () {
      expect(isInvitationLink(Uri.parse('/')), isFalse);
      expect(isInvitationLink(Uri.parse('/entrar')), isFalse);
      expect(isInvitationLink(Uri.parse('/diario?dia=2026-11-12')), isFalse);
    });
  });

  group('invitationTokenIn', () {
    test('reads the token whatever shape the link came in', () {
      expect(invitationTokenIn(Uri.parse('fitapp://convite?token=$_token')), _token);
      expect(invitationTokenIn(Uri.parse('/?token=$_token')), _token);
      expect(invitationTokenIn(Uri.parse('/convite?token=$_token')), _token);
    });

    test('a link with no token carries none', () {
      expect(invitationTokenIn(Uri.parse('/convite')), isNull);
      expect(invitationTokenIn(Uri.parse('/convite?token=')), isNull);
    });

    test('a broken token comes back as it arrived, to be refused by name', () {
      // Not the same thing as no token at all: the screen says "link inválido"
      // instead of opening an empty field.
      expect(invitationTokenIn(Uri.parse('/convite?token=curto')), 'curto');
    });
  });

  group('invitationTokenTyped', () {
    test('the code, typed on its own', () {
      expect(invitationTokenTyped(_token), _token);
      expect(invitationTokenTyped('  $_token  '), _token);
    });

    test('the whole link, pasted out of the message', () {
      expect(
        invitationTokenTyped('https://painel.fit-app.com.br/convite?token=$_token'),
        _token,
      );
      expect(invitationTokenTyped('fitapp://convite?token=$_token'), _token);
    });

    test('an empty field is not a code', () {
      expect(invitationTokenTyped(''), isNull);
      expect(invitationTokenTyped('   '), isNull);
    });
  });

  group('looksLikeInvitationToken', () {
    test('a token of the length the API issues', () {
      expect(looksLikeInvitationToken(_token), isTrue);
    });

    test('half a pasted message is not a token', () {
      expect(looksLikeInvitationToken('curto'), isFalse);
      expect(looksLikeInvitationToken(''), isFalse);
      expect(looksLikeInvitationToken('a' * 201), isFalse);
      expect(looksLikeInvitationToken('seu convite chegou $_token'), isFalse);
    });

    test('nothing is said about the characters: the API matches the hash', () {
      // Twenty characters of anything without whitespace gets to be refused by
      // the API, which is the only thing that knows what a token opens.
      expect(looksLikeInvitationToken('12345678901234567890'), isTrue);
    });
  });
}
