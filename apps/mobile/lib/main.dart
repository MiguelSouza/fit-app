import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'src/app/fit_app.dart';
import 'src/core/config/app_config.dart';
import 'src/core/config/app_config_provider.dart';
import 'src/core/observability/sentry.dart';

/// Where the app starts, and the only place that knows the order of the four
/// things that have to happen before the first frame.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Throws when a `--dart-define` is missing, naming what is missing and
  // printing no value. Better here, loud, than a build that silently talks to
  // the wrong environment (`AppConfig`).
  final config = AppConfig.fromEnvironment();

  await Supabase.initialize(
    url: config.supabaseUrl,

    // `publishableKey` is the name Supabase now gives the public key;
    // `anonKey`, the parameter the panel still uses, is the deprecated spelling
    // of the same thing. The define keeps the name the repository already has
    // for it (`SUPABASE_ANON_KEY`, in `.env.example`) — renaming a variable
    // every app reads is its own change, not a side effect of this one.
    publishableKey: config.supabaseAnonKey,

    // `debug` defaults to the value of `kDebugMode`, and what it prints is the
    // traffic of the Auth client — events, and the session that came with
    // them. That is personal data and a token in the device log, which
    // `CLAUDE.md` rules out at any level. Off everywhere, and it stays off.
    debug: false,
  );

  // Starts Sentry when this build has a DSN, and runs the app either way. The
  // app goes inside it so that an error in the first frame is already in the
  // zone the SDK watches (ADR 0013).
  await runWithSentry(config, () {
    // Who is using the app, by id, kept in step with the session. After
    // `Supabase.initialize`, because it reads the session that was restored.
    watchSessionForSentry(Supabase.instance.client.auth);

    runApp(
      ProviderScope(
        // The one override of the app: everything that needs an address reads
        // `appConfigProvider`, so no widget and no provider touches a Dart
        // define, and a test hands over the addresses it wants.
        overrides: [appConfigProvider.overrideWithValue(config)],
        child: const FitApp(),
      ),
    );
  });
}
