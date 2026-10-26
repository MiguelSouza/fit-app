import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_config_provider.dart';

/// The error the button throws. It carries a name, an e-mail and a weight on
/// purpose: in the Sentry issue the three have to show up as `[redacted]` —
/// seeing that an event arrived is half the check, the other half is what it
/// did **not** carry.
///
/// Synthetic data, like every value in this repository outside production
/// (`CLAUDE.md`, "Testes").
class SentryCheckError extends Error {
  @override
  String toString() =>
      'erro proposital do app: paciente Ana Souza <ana.souza@example.com>, peso 61,4 kg';
}

/// Provokes an error, which is the acceptance criterion of card F-16 ("um erro
/// provocado em cada app aparece no Sentry") made reproducible instead of
/// being a `throw` somebody adds by hand and forgets to take back out.
///
/// **It renders nothing on a production build**, the same rule as the
/// environment badge it sits next to: there is no crash button in front of a
/// patient. Flutter catches what a tap handler throws and hands it to
/// `FlutterError.onError`, which is where the SDK is listening.
class SentryCheckButton extends ConsumerWidget {
  const SentryCheckButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(appConfigProvider).environment.isProduction) {
      return const SizedBox.shrink();
    }

    return IconButton(
      tooltip: 'Provocar um erro de teste',
      icon: const Icon(Icons.bug_report_outlined),
      onPressed: () => throw SentryCheckError(),
    );
  }
}
