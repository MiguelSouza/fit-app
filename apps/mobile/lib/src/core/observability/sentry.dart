import 'dart:async';

import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/app_config.dart';
import 'scrub_event.dart';

/// Where an error of the app goes besides the screen (ADR 0013).
///
/// Two layers keep the patient out of what leaves the device, the same two as
/// in the API: the options below say what the SDK must never pick up, and
/// [scrubSentryEvent] runs last, on the event as it is about to go, and masks
/// what is left by field name.
///
/// Without a `SENTRY_DSN` define the SDK is never started and [appRunner] runs
/// as it always did — which is what a build from somebody's machine wants.
///
/// @param appRunner what starts the app. It is handed to the SDK instead of
///   being called here so that an error thrown while the first frame is built
///   is already inside the zone the SDK watches.
Future<void> runWithSentry(AppConfig config, FutureOr<void> Function() appRunner) async {
  final String? dsn = config.sentryDsn;

  if (dsn == null) {
    await appRunner();
    return;
  }

  await SentryFlutter.init((SentryFlutterOptions options) {
    options.dsn = dsn;

    // Which deployment and which version. `APP_ENV` already says the first
    // one, and it is the same word the badge on the app bar shows.
    options.environment = config.environment.name;

    final String? release = config.sentryRelease;
    if (release != null) options.release = release;

    // The device name, the user's ip and the username, which the SDK would
    // otherwise attach on its own. Who is using the app is set by id, and
    // only by id, in `watchSessionForSentry` below.
    options.sendDefaultPii = false;

    // A screenshot of this app is a screen with a patient on it, and the view
    // hierarchy is the same thing in text. Both are off by default; they are
    // written down because what they would send is exactly what `CLAUDE.md`
    // forbids, and a default is not a decision.
    options.attachScreenshot = false;
    options.attachViewHierarchy = false;

    // Session replay records the screen. Same reason, with video.
    options.replay.sessionSampleRate = 0.0;
    options.replay.onErrorSampleRate = 0.0;

    // Errors only. Tracing is a different decision with a different cost, and
    // it is not what this card asks for.
    options.tracesSampleRate = 0.0;

    // Everything printed becomes a breadcrumb otherwise. The app prints
    // nothing (`avoid_print` in `analysis_options.yaml`), and a crumb nobody
    // writes on purpose is a crumb nobody reviewed.
    options.enablePrintBreadcrumbs = false;

    // The last word, on the event as it goes out. The types come from
    // `BeforeSendCallback`; the second argument is the hint, which this
    // filter has no use for.
    options.beforeSend = (event, hint) => scrubSentryEvent(event);
  }, appRunner: appRunner);
}

/// Keeps Sentry's idea of who is using the app in step with the session — **by
/// id and nothing else** (`CLAUDE.md`: ids and codes, never a name or an
/// e-mail).
///
/// Signing out clears it, which is the half that matters: an error after that
/// must not still be attributed to whoever was signed in before.
///
/// The subscription is never cancelled on purpose: it lives as long as the
/// process does. With no SDK started, every call below is a no-op.
StreamSubscription<AuthState> watchSessionForSentry(GoTrueClient auth) {
  unawaited(_setSentryUser(auth.currentSession?.user.id));

  return auth.onAuthStateChange.listen(
    (AuthState state) => unawaited(_setSentryUser(state.session?.user.id)),

    // The stream carries errors too — a token refresh with no network — and a
    // subscription without `onError` lets them out as unhandled, with the Auth
    // request inside (`auth_providers.dart`, same reasoning).
    onError: (Object _) {},
  );
}

Future<void> _setSentryUser(String? id) async {
  await Sentry.configureScope(
    (Scope scope) => scope.setUser(id == null ? null : SentryUser(id: id)),
  );
}
