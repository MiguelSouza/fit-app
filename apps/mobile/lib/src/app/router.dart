import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/auth_providers.dart';
import '../auth/sign_in_screen.dart';
import '../home/home_screen.dart';

/// The home of the app, protected: it is what the patient opens on.
const String homePath = '/';

/// The sign in. The only route that answers without a session.
const String signInPath = '/entrar';

/// The routes that answer without a session — a closed list, not a path
/// pattern, the same asymmetry as the global guard of the API (ADR 0007) and as
/// the panel's `PUBLIC_PATHS`: forgetting to open a route gives a redirect
/// somebody notices immediately, while a patient screen left open by
/// forgetting does not show up at all.
const List<String> publicPaths = <String>[signInPath];

/// Where to go, given a session and where the person is trying to go.
///
/// A pure function so it can be read and tested on its own — it is the whole
/// of "what is protected" in this app. `null` means "stay".
///
/// What it does **not** do is authorization. Link, consent and
/// `professional_type` are checked by the API inside the use case (ADR 0007);
/// a screen the app hides is convenience, not access control.
String? redirectFor({required bool signedIn, required String location}) {
  final isPublic = publicPaths.contains(location);

  if (!signedIn && !isPublic) return signInPath;
  if (signedIn && isPublic) return homePath;

  return null;
}

final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(supabaseAuthProvider);

  final router = GoRouter(
    initialLocation: homePath,

    // `go_router` runs its redirect again whenever this notifies, which is how
    // signing in and signing out move the app without a single `push` in the
    // screens: the session changes, the redirect below answers again.
    refreshListenable: ref.watch(sessionChangesProvider),

    redirect: (context, state) =>
        redirectFor(signedIn: hasSession(auth), location: state.matchedLocation),

    routes: <RouteBase>[
      GoRoute(path: homePath, builder: (context, state) => const HomeScreen()),
      GoRoute(path: signInPath, builder: (context, state) => const SignInScreen()),
    ],
  );

  ref.onDispose(router.dispose);

  return router;
});
