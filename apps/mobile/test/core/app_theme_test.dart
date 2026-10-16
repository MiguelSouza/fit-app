import 'package:fit_app/src/core/theme/app_colors.dart';
import 'package:fit_app/src/core/theme/app_theme.dart';
import 'package:fit_app/src/core/theme/app_typography.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AppTheme.dark', () {
    test('is dark, which is the default of the app', () {
      expect(AppTheme.dark.brightness, Brightness.dark);
      expect(AppTheme.dark.scaffoldBackgroundColor, AppColors.background);
    });

    test('takes its colours from the tokens, so one file changes the app', () {
      final scheme = AppTheme.dark.colorScheme;

      expect(scheme.primary, AppColors.primary);
      expect(scheme.surface, AppColors.surface);
      expect(scheme.error, AppColors.danger);
      expect(scheme.outline, AppColors.border);
    });

    test('takes its type from the tokens', () {
      final textTheme = AppTheme.dark.textTheme;

      expect(textTheme.bodyMedium?.fontSize, AppTypography.bodySize);
      expect(textTheme.titleLarge?.fontSize, AppTypography.titleSize);
      expect(textTheme.labelSmall?.color, AppColors.foregroundMuted);
    });
  });
}
