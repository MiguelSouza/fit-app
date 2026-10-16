import 'package:flutter/material.dart';

/// The colour tokens of the app, and the only place a hex value is written.
///
/// Dark is the direction of the design system (card F-14), so these are the
/// dark values and there is no light set yet. The point of the token is the
/// swap: card **OP-06** brings the real palette, and it changes this file and
/// nothing else — no widget in `lib/` holds a `Color(0x...)`.
///
/// The palette is deliberately neutral, the same choice the panel made while it
/// waited for the design system: a grey scale plus one accent, and the two
/// colours that carry meaning (danger and warning, which the alert screens of
/// the `insights` module will need).
abstract final class AppColors {
  /// What the app paints behind everything.
  static const Color background = Color(0xFF0B0F14);

  /// A card, a sheet, a field: one step up from the background.
  static const Color surface = Color(0xFF151B23);

  /// A second step, for what sits on top of a surface.
  static const Color surfaceRaised = Color(0xFF1E2731);

  /// Hairlines and field borders.
  static const Color border = Color(0xFF2B3542);

  /// The accent: a filled button, a selected tab, a focus ring.
  static const Color primary = Color(0xFF4ADE80);

  /// Text and icons over [primary]. Dark on purpose: the accent is light.
  static const Color onPrimary = Color(0xFF07130B);

  /// Body text over [background] and [surface].
  static const Color foreground = Color(0xFFE8EDF2);

  /// Labels, captions, the second line of a list item.
  static const Color foregroundMuted = Color(0xFF93A1B1);

  /// A refusal, a failed call, a destructive action.
  static const Color danger = Color(0xFFF87171);

  static const Color onDanger = Color(0xFF1A0707);

  /// Attention without failure — the badge of a non production build, and
  /// later the "merece revisão" of an alert.
  static const Color warning = Color(0xFFFBBF24);

  static const Color onWarning = Color(0xFF1A1205);
}
