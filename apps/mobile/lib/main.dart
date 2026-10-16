import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'src/app/fit_app.dart';
import 'src/core/config/app_config.dart';
import 'src/core/config/app_config_provider.dart';

/// Where the app starts, and the only place that knows the order of the three
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

  runApp(
    ProviderScope(
      // The one override of the app: everything that needs an address reads
      // `appConfigProvider`, so no widget and no provider touches a Dart
      // define, and a test hands over the addresses it wants.
      overrides: [appConfigProvider.overrideWithValue(config)],
      child: const FitApp(),
    ),
  );
}
