import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_providers.dart';
import '../auth/sign_in_screen.dart';
import '../home/home_screen.dart';
import '../invitation/invitation_link.dart';
import '../invitation/invitation_screen.dart';

/// The home of the app, protected: it is what the patient opens on.
const String homePath = '/';

/// The sign in. The only route that answers without a session.
const String signInPath = '/entrar';

/// The onboarding by invitation: where the deep link lands and where the code
/// typed by hand goes (card P-01).
const String invitePath = '/$invitationLinkHost';

/// The routes that answer without a session — a closed list, not a path
/// pattern, the same asymmetry as the global guard of the API (ADR 0007) and as
/// the panel's `PUBLIC_PATHS`: forgetting to open a route gives a redirect
/// somebody notices immediately, while a patient screen left open by
/// forgetting does not show up at all.
const List<String> publicPaths = <String>[signInPath, invitePath];

/// The routes that answer **with** a session as well.
///
/// Only the invitation, and it is not a convenience: the patient signs up in
/// the middle of that flow, so the session appears between two of its screens.
/// A redirect to the home at that moment would throw the person out of their
/// own onboarding, one screen before the consents.
const List<String> sessionAgnosticPaths = <String>[invitePath];

/// Where to go, given a session and where the person is trying to go.
///
/// A pure function so it can be read and tested on its own — it is the whole
/// of "what is protected" in this app, plus the one normalisation a deep link
/// needs. `null` means "stay".
///
/// What it does **not** do is authorization. Link, consent and
/// `professional_type` are checked by the API inside the use case (ADR 0007);
/// a screen the app hides is convenience, not access control.
String? redirectFor({required bool signedIn, required Uri location}) {
  final invitation = invitationLocationFor(location);

  // A deep link, in whichever shape the platform delivered it. The comparison
  // is what keeps this from looping: a location that is already the normalised
  // one is left alone.
  if (invitation != null && invitation != location.toString()) return invitation;

  final path = location.path.isEmpty ? homePath : location.path;
  final isPublic = publicPaths.contains(path);

  if (!signedIn && !isPublic) return signInPath;
  if (signedIn && isPublic && !sessionAgnosticPaths.contains(path)) return homePath;

  return null;
}

/// An invitation link, as a location of this app — or `null` when the uri is
/// not one.
///
/// This is the one place that knows that the two platforms deliver a deep link
/// differently: Android hands over the path and the query and drops the host,
/// so `fitapp://convite?token=abc` arrives as `/?token=abc`, while iOS hands
/// over the whole address (`isInvitationLink`). Both come out of here as
/// `/convite?token=abc`, and the screen below reads one shape.
String? invitationLocationFor(Uri uri) {
  if (!isInvitationLink(uri)) return null;

  final token = invitationTokenIn(uri);

  if (token == null) return invitePath;

  return Uri(
    path: invitePath,
    queryParameters: <String, String>{invitationTokenParameter: token},
  ).toString();
}

final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(supabaseAuthProvider);

  final router = GoRouter(
    initialLocation: homePath,

    // `go_router` runs its redirect again whenever this notifies, which is how
    // signing in and signing out move the app without a single `push` in the
    // screens: the session changes, the redirect below answers again.
    refreshListenable: ref.watch(sessionChangesProvider),

    // `state.uri` and not `state.matchedLocation`: a deep link carries its
    // token in the query, and a link that arrives with the host instead of the
    // path matches no route at all — both are read whole, above.
    redirect: (context, state) => redirectFor(signedIn: hasSession(auth), location: state.uri),

    routes: <RouteBase>[
      GoRoute(path: homePath, builder: (context, state) => const HomeScreen()),
      GoRoute(path: signInPath, builder: (context, state) => const SignInScreen()),
      GoRoute(
        path: invitePath,
        builder: (context, state) =>
            InvitationScreen(token: state.uri.queryParameters[invitationTokenParameter]),
      ),
    ],
  );

  ref.onDispose(router.dispose);

  return router;
});
