import 'package:fit_app/src/auth/sign_in_screen.dart';
import 'package:fit_app/src/core/config/app_config.dart';
import 'package:fit_app/src/core/config/app_config_provider.dart';
import 'package:fit_app/src/core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

const AppConfig _config = AppConfig(
  environment: AppEnvironment.local,
  apiUrl: 'http://127.0.0.1:3333',
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'chave-de-teste',
);

/// The sign in screen on its own, with no Supabase behind it — which is what
/// makes the tests below mean something: `supabaseAuthProvider` reads
/// `Supabase.instance`, which throws until `main.dart` initialises it, so a
/// screen that asked Auth anything here would fail the test. Every case below
/// is a form the screen must refuse on its own.
Future<void> pumpSignIn(WidgetTester tester) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [appConfigProvider.overrideWithValue(_config)],
      child: MaterialApp(theme: AppTheme.dark, home: const SignInScreen()),
    ),
  );
}

void main() {
  testWidgets('asks for both fields before asking Auth anything', (tester) async {
    await pumpSignIn(tester);

    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pump();

    expect(find.text('Informe seu e-mail.'), findsOne);
    expect(find.text('Informe sua senha.'), findsOne);
  });

  testWidgets('catches a typo in the e-mail before the round trip', (tester) async {
    await pumpSignIn(tester);

    await tester.enterText(find.widgetWithText(TextFormField, 'E-mail'), 'paciente-sem-arroba');
    await tester.enterText(find.widgetWithText(TextFormField, 'Senha'), 'senha-de-teste');
    await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
    await tester.pump();

    expect(find.text('Informe um e-mail válido.'), findsOne);
    expect(find.text('Informe sua senha.'), findsNothing);
  });

  testWidgets('a non production build says so on the sign in too', (tester) async {
    await pumpSignIn(tester);

    expect(find.text('LOCAL'), findsOne);
  });
}
