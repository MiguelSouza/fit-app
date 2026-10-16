/// Which deployment the app is talking to.
///
/// The app behaves the same in all three — the environment only picks the
/// addresses and whether the screens carry the badge that says "this is not
/// production". Nothing here changes a rule: rules live in the API.
enum AppEnvironment {
  local,
  staging,
  production;

  /// Whether this build points at production, which is what the badge on the
  /// app bar asks about — it shows on the other two.
  bool get isProduction => this == AppEnvironment.production;
}

/// Thrown when the app was built without the values it needs to start.
///
/// The message names the defines that are missing and **never prints a value**:
/// one of them is a key, and this message reaches the screen of a crashed app
/// and the console of whoever built it.
class MissingConfigError extends Error {
  MissingConfigError(this.missing);

  /// The names of the `--dart-define`s that came in empty.
  final List<String> missing;

  @override
  String toString() =>
      'Faltam valores de ambiente: ${missing.join(', ')}. '
      'Passe-os em --dart-define (veja o bloco apps/mobile do .env.example).';
}

/// The addresses the app is built with.
///
/// Flutter does not read `.env`: a Dart define is baked into the binary at
/// **compile time**, which is why `fromEnvironment` below is the only place
/// that touches `String.fromEnvironment` and why it has to be `const`. The
/// values for each environment are in the `apps/mobile` block of
/// `.env.example`, and the ready made command lines are in the README.
///
/// The key here is the **anon** key, which is public by definition. The service
/// role key never reaches the app: it ignores RLS and only the API uses it.
class AppConfig {
  const AppConfig({
    required this.environment,
    required this.apiUrl,
    required this.supabaseUrl,
    required this.supabaseAnonKey,
  });

  /// Reads the defines of this build and validates them.
  ///
  /// Three defines are mandatory and have no default: a default would let a
  /// build aimed at staging quietly talk to a developer's machine, and there is
  /// no honest default for a key. `APP_ENV` does default — to `local`, the one
  /// environment where being wrong costs nothing.
  ///
  /// @throws [MissingConfigError] naming what is missing.
  factory AppConfig.fromEnvironment() => AppConfig.from(
    environment: _appEnv,
    apiUrl: _apiUrl,
    supabaseUrl: _supabaseUrl,
    supabaseAnonKey: _supabaseAnonKey,
  );

  /// The same validation, on values given by hand. It is what the tests use,
  /// and what keeps [AppConfig.fromEnvironment] down to four constants.
  factory AppConfig.from({
    required String environment,
    required String apiUrl,
    required String supabaseUrl,
    required String supabaseAnonKey,
  }) {
    final missing = <String>[
      if (apiUrl.trim().isEmpty) 'API_URL',
      if (supabaseUrl.trim().isEmpty) 'SUPABASE_URL',
      if (supabaseAnonKey.trim().isEmpty) 'SUPABASE_ANON_KEY',
    ];

    if (missing.isNotEmpty) throw MissingConfigError(missing);

    return AppConfig(
      environment: parseEnvironment(environment),
      apiUrl: apiUrl.trim(),
      supabaseUrl: supabaseUrl.trim(),
      supabaseAnonKey: supabaseAnonKey.trim(),
    );
  }

  /// Reads `APP_ENV`. An empty or unknown value is `local`: a build that failed
  /// to say where it is going is a build from somebody's machine, and treating
  /// it as production is the one reading that could put a staging badge over
  /// real patients — or take the badge off a test build.
  static AppEnvironment parseEnvironment(String value) =>
      AppEnvironment.values.asNameMap()[value.trim().toLowerCase()] ?? AppEnvironment.local;

  final AppEnvironment environment;

  /// Address of the fit-app API. On the Android emulator, `127.0.0.1` is the
  /// emulator itself — the host is `10.0.2.2` (README).
  final String apiUrl;

  final String supabaseUrl;

  /// Public (anon) key of the Supabase project.
  final String supabaseAnonKey;

  static const String _appEnv = String.fromEnvironment('APP_ENV', defaultValue: 'local');
  static const String _apiUrl = String.fromEnvironment('API_URL');
  static const String _supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const String _supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
}
