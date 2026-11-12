import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Supabase Auth, and nothing else of Supabase.
///
/// The provider hands out `client.auth`, not the client — the same narrowing
/// the panel does (`apps/web/src/lib/supabase/auth.ts`), and rule 6 of
/// `CLAUDE.md` turned into a type: with no full client in reach there is no
/// `.from()`, no `.rpc()` and no `.storage` for a screen to call by accident.
/// Signing in is the one thing the app asks Supabase directly; patient data
/// comes from the API, which is what checks the link and the consent.
final supabaseAuthProvider = Provider<GoTrueClient>((ref) => Supabase.instance.client.auth);

/// Whether there is a session right now.
///
/// `currentSession` is read, not watched: `Supabase.initialize` restores the
/// stored session before the first frame, so this answers synchronously and no
/// screen has to render a "deciding" state. What makes it change is
/// [sessionChangesProvider], which the router listens to.
bool hasSession(GoTrueClient auth) => auth.currentSession != null;

/// The session changing, as something the router can listen to.
///
/// `go_router` asks for a `Listenable` in `refreshListenable`, and
/// `onAuthStateChange` is a `Stream`: this is the adapter, and it is the whole
/// reason the class exists. It carries no session and no token — whoever needs
/// one asks the Auth client at that moment.
class SessionChanges extends ChangeNotifier {
  SessionChanges(Stream<AuthState> changes) {
    _subscription = changes.listen(
      (_) => notifyListeners(),

      // The stream carries errors as well as events, and the Auth client
      // documents that a subscription without `onError` lets them out as
      // unhandled errors — a token refresh with no network arrives here as an
      // `AuthRetryableFetchException`, and Flutter would print it, with the
      // Auth request in it. There is nothing to notify, because a session that
      // really ended comes as a `signedOut` event and not as an error, and
      // nothing to log (`CLAUDE.md`).
      onError: (Object _) {},
    );
  }

  late final StreamSubscription<AuthState> _subscription;

  @override
  void dispose() {
    unawaited(_subscription.cancel());
    super.dispose();
  }
}

final sessionChangesProvider = Provider<SessionChanges>((ref) {
  final changes = SessionChanges(ref.watch(supabaseAuthProvider).onAuthStateChange);

  ref.onDispose(changes.dispose);

  return changes;
});

/// Signing in with e-mail and password.
///
/// Returns `true` when a session came back and `false` for **any** refusal,
/// with no reason attached — on purpose, and for two reasons. One: telling the
/// screen "this e-mail does not exist" hands whoever is only guessing the list
/// of who has an account here, which is the same reason the API answers one
/// single 401 (ADR 0007). Two: the error object of Auth carries the e-mail of
/// the attempt, so it must not be returned, rethrown or logged — never log
/// personal data (`CLAUDE.md`).
Future<bool> signIn(GoTrueClient auth, {required String email, required String password}) async {
  try {
    final response = await auth.signInWithPassword(email: email, password: password);

    return response.session != null;
  } on Exception {
    return false;
  }
}

/// What came of creating an account.
enum SignUpOutcome {
  /// The account exists and the session is open: the onboarding goes on, and
  /// the next request already carries a token (`api_client.dart`).
  signedIn,

  /// The account was created and Auth is waiting for the e-mail to be
  /// confirmed. There is no session, so there is no invitation to accept yet:
  /// the API reads who is accepting from the token (ADR 0007).
  confirmationNeeded,

  /// Auth refused, with no reason attached.
  refused,
}

/// Creating the patient's account, which is the first half of the onboarding
/// by invitation (card P-01).
///
/// The refusal carries no reason, for the same two reasons as [signIn]: a
/// message that tells apart "this e-mail already has an account" from "this
/// password is weak" hands the list of who is on the platform to whoever is
/// only guessing, and the error object of Auth carries the e-mail of the
/// attempt, so it is neither returned nor logged (CLAUDE.md, "Saúde e LGPD").
///
/// Whether a confirmation e-mail is sent is the Supabase project's setting and
/// not a decision of this app, which is why the outcome has three values and
/// not two: with confirmation on, there is a user and no session, and the
/// patient finishes the invitation after confirming.
Future<SignUpOutcome> signUp(
  GoTrueClient auth, {
  required String email,
  required String password,
}) async {
  try {
    final response = await auth.signUp(email: email, password: password);

    if (response.session != null) return SignUpOutcome.signedIn;

    return response.user == null ? SignUpOutcome.refused : SignUpOutcome.confirmationNeeded;
  } on Exception {
    return SignUpOutcome.refused;
  }
}

/// Signing out: drops the session here and revokes it at the Auth server.
///
/// A failure is swallowed deliberately. `signOut` already clears the local
/// session before talking to the server, so by the time it throws the person is
/// out of the app either way, and the only thing left to say would be the
/// reason — which belongs to no screen.
Future<void> signOut(GoTrueClient auth) async {
  try {
    await auth.signOut();
  } on Exception {
    // Nothing to do and nothing to log: the local session is gone.
  }
}
