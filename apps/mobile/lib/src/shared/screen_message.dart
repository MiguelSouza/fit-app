import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';

/// What a message means, which is what picks its colour.
enum MessageTone { neutral, danger }

/// A line the person has to read: a refusal, a call that did not go through.
///
/// It exists so that no screen writes its own box — the design system (card
/// OP-06) dresses this one widget. It takes text that is already in pt-BR and
/// already safe to show: the `message` of the API's error envelope, which the
/// contract guarantees carries no patient data.
class ScreenMessage extends StatelessWidget {
  const ScreenMessage({required this.message, this.tone = MessageTone.neutral, super.key});

  final String message;
  final MessageTone tone;

  @override
  Widget build(BuildContext context) {
    final danger = tone == MessageTone.danger;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: danger ? AppColors.danger.withValues(alpha: 0.12) : AppColors.surfaceRaised,
        border: Border.all(color: danger ? AppColors.danger : AppColors.border),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        message,
        style: Theme.of(context).textTheme.bodyMedium
            ?.copyWith(color: danger ? AppColors.danger : AppColors.foreground),
      ),
    );
  }
}
