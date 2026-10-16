import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/theme/app_theme.dart';
import 'router.dart';

/// The root of the app: the theme, the locale and the router, and nothing else.
class FitApp extends ConsumerWidget {
  const FitApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'fit-app',
      debugShowCheckedModeBanner: false,

      // One theme, dark, for both brightnesses of the system — the direction of
      // the design system (`AppTheme`).
      theme: AppTheme.dark,

      // pt-BR, and the delegates that come with it: without them the date
      // picker, the text selection menu and every other string Flutter itself
      // provides would answer in English, under screens written in Portuguese.
      locale: const Locale('pt', 'BR'),
      supportedLocales: const <Locale>[Locale('pt', 'BR')],
      localizationsDelegates: const <LocalizationsDelegate<Object>>[
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],

      routerConfig: ref.watch(routerProvider),
    );
  }
}
