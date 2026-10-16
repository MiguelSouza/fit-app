import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app_config.dart';

/// The config of this build, injected at the root (`main.dart`).
///
/// It throws instead of reading the defines itself so that
/// `AppConfig.fromEnvironment` stays the only place in the app that touches
/// `String.fromEnvironment` — and so a test hands over the addresses it wants
/// without compiling anything.
final appConfigProvider = Provider<AppConfig>((ref) {
  throw UnimplementedError('appConfigProvider precisa de override no ProviderScope (main.dart).');
});
