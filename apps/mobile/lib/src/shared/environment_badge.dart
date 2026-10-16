import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_config.dart';
import '../core/config/app_config_provider.dart';
import '../core/theme/app_colors.dart';

/// Says, on the screen, which environment this build is talking to.
///
/// Nothing on a non production build should be mistaken for the real thing: a
/// local or staging app holds synthetic patients (`scripts/`), and a tester
/// looking at a number has to know which database answered it. On production it
/// renders nothing.
class EnvironmentBadge extends ConsumerWidget {
  const EnvironmentBadge({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final environment = ref.watch(appConfigProvider).environment;

    if (environment.isProduction) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: AppColors.warning.withValues(alpha: 0.16),
        border: Border.all(color: AppColors.warning),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        _label(environment),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.warning),
      ),
    );
  }

  /// In pt-BR, like everything the user reads.
  static String _label(AppEnvironment environment) => switch (environment) {
    AppEnvironment.local => 'LOCAL',
    AppEnvironment.staging => 'HOMOLOGAÇÃO',
    AppEnvironment.production => 'PRODUÇÃO',
  };
}
