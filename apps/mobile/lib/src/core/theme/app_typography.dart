import 'package:flutter/material.dart';

import 'app_colors.dart';

/// The type tokens of the app: sizes, weights and line heights in one place.
///
/// No font is bundled and no font is downloaded. The family is the platform's
/// own (`fontFamily: null` is San Francisco on iOS and Roboto on Android),
/// which is a deliberate hold: picking a typeface is card **OP-06**, and a
/// font package added now would be a dependency with no decision behind it
/// (`CLAUDE.md`, "Não faça"). When the family arrives it is one constant here.
///
/// What every screen uses is `Theme.of(context).textTheme`, never these
/// constants: the tokens feed [textTheme] below, and that is the only consumer.
abstract final class AppTypography {
  /// `null` means "the platform's own". Card OP-06 names the real family.
  static const String? family = null;

  static const double displaySize = 28;
  static const double titleSize = 20;
  static const double bodySize = 16;
  static const double labelSize = 13;
  static const double captionSize = 11;

  static const FontWeight regular = FontWeight.w400;
  static const FontWeight medium = FontWeight.w500;
  static const FontWeight bold = FontWeight.w700;

  /// Body copy gets room to breathe; headings are tighter, as they should be.
  static const double looseHeight = 1.45;
  static const double tightHeight = 1.2;

  /// The [TextTheme] of the app, built from the tokens above.
  ///
  /// Only the five slots the app actually uses are filled, and each screen
  /// reads them by name (`titleLarge`, `bodyMedium`…). A slot nobody fills
  /// falls back to the Material default, which is fine — what matters is that
  /// no screen hard codes a size.
  static TextTheme get textTheme => const TextTheme(
    displaySmall: TextStyle(
      fontFamily: family,
      fontSize: displaySize,
      fontWeight: bold,
      height: tightHeight,
      color: AppColors.foreground,
    ),
    titleLarge: TextStyle(
      fontFamily: family,
      fontSize: titleSize,
      fontWeight: medium,
      height: tightHeight,
      color: AppColors.foreground,
    ),
    bodyMedium: TextStyle(
      fontFamily: family,
      fontSize: bodySize,
      fontWeight: regular,
      height: looseHeight,
      color: AppColors.foreground,
    ),
    labelLarge: TextStyle(
      fontFamily: family,
      fontSize: labelSize,
      fontWeight: medium,
      height: tightHeight,
      color: AppColors.foreground,
    ),
    labelSmall: TextStyle(
      fontFamily: family,
      fontSize: captionSize,
      fontWeight: medium,
      height: tightHeight,
      color: AppColors.foregroundMuted,
    ),
  );
}
