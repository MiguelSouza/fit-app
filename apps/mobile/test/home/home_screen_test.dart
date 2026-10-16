import 'package:fit_app/src/api/api_failure.dart';
import 'package:fit_app/src/api/me.dart';
import 'package:fit_app/src/core/config/app_config.dart';
import 'package:fit_app/src/core/config/app_config_provider.dart';
import 'package:fit_app/src/core/theme/app_theme.dart';
import 'package:fit_app/src/home/home_screen.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const AppConfig _config = AppConfig(
  environment: AppEnvironment.local,
  apiUrl: 'http://127.0.0.1:3333',
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'chave-de-teste',
);

/// The answer of `GET /v1/me`, built from the generated model: the test speaks
/// the contract, like the screen does. The id is the nil UUID, the same one the
/// provisional endpoint answers — no patient, synthetic or otherwise, is
/// invented in a test (`CLAUDE.md`).
final MeResponse _me = MeResponse(
  (b) => b
    ..personId = '00000000-0000-0000-0000-000000000000'
    ..role = PersonRole.patient
    ..timeZone = 'America/Sao_Paulo',
);

/// Puts the home screen on screen with one answer for `GET /v1/me`, which is
/// the only thing it asks for. The config is overridden too, because the badge
/// on the app bar reads it — in the app that value comes from a Dart define.
Future<void> pumpHome(WidgetTester tester, {required Future<MeResponse> Function() answer}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        appConfigProvider.overrideWithValue(_config),
        meProvider.overrideWith((ref) => answer()),
      ],
      child: MaterialApp(theme: AppTheme.dark, home: const HomeScreen()),
    ),
  );

  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows what the API answered, and nothing it did not', (tester) async {
    await pumpHome(tester, answer: () async => _me);

    expect(find.text('Paciente'), findsOne);
    expect(find.text('America/Sao_Paulo'), findsOne);
    expect(find.text('00000000-0000-0000-0000-000000000000'), findsOne);
  });

  testWidgets('a non production build says so on the app bar', (tester) async {
    await pumpHome(tester, answer: () async => _me);

    expect(find.text('LOCAL'), findsOne);
  });

  testWidgets('a refused token offers the sign in, not a retry', (tester) async {
    await pumpHome(
      tester,
      answer: () async => throw const ApiFailure(
        message: 'Sessão inválida ou expirada. Entre novamente.',
        code: 'auth.unauthorized',
        unauthorized: true,
      ),
    );

    expect(find.text('Sessão inválida ou expirada. Entre novamente.'), findsOne);
    expect(find.text('Entrar novamente'), findsOne);
    expect(find.text('Tentar de novo'), findsNothing);
  });

  testWidgets('an API that did not answer offers a retry', (tester) async {
    await pumpHome(
      tester,
      answer: () async =>
          throw const ApiFailure(message: 'Não foi possível falar com a API agora.'),
    );

    expect(find.text('Não foi possível falar com a API agora.'), findsOne);
    expect(find.text('Tentar de novo'), findsOne);
    expect(find.text('Entrar novamente'), findsNothing);
  });
}
