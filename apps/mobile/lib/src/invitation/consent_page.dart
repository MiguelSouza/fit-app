import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';
import '../shared/screen_message.dart';
import 'consent_terms.dart';

/// One purpose, one screen: the text of the term, the version, and the answer
/// (card P-01, "telas de consentimento claras, uma por escopo").
///
/// It holds the tick of its own checkbox and nothing else — which purpose is
/// being asked, and what to do with the answer, are the flow's
/// (`invitation_screen.dart`). That is what makes it testable on its own, and
/// the acceptance criterion "não dá para avançar sem os consentimentos
/// obrigatórios" is this widget: for a required purpose there is no button
/// that moves forward until the box is ticked, and no way around it.
///
/// It is not the only refusal, and not the one that counts: the API answers
/// 422 to an acceptance without `health_data` and `share_with_professional`,
/// for every client (ADR 0016). This one is here so the patient is told before
/// the round trip, and in the words of the purpose they skipped.
class ConsentPage extends StatefulWidget {
  const ConsentPage({
    required this.term,
    required this.step,
    required this.total,
    required this.onAnswered,
    this.onBack,
    this.initiallyAccepted = false,
    super.key,
  });

  final ConsentTerm term;

  /// What the patient had already answered for this purpose, for when they
  /// come back a screen. A purpose they had ticked stays ticked.
  final bool initiallyAccepted;

  /// Which of the purposes this is, counting from one: the patient should see
  /// how long the queue is before agreeing to the first one.
  final int step;
  final int total;

  /// The answer: `true` when the box was ticked. An optional purpose answers
  /// `false` and the flow goes on; a required one never answers `false`.
  final ValueChanged<bool> onAnswered;

  /// Back to the previous purpose, or `null` on the first one.
  final VoidCallback? onBack;

  @override
  State<ConsentPage> createState() => _ConsentPageState();
}

class _ConsentPageState extends State<ConsentPage> {
  late bool _accepted = widget.initiallyAccepted;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final term = widget.term;

    // The whole of the rule: a required purpose has no way forward until the
    // box is ticked. A disabled button and not a message afterwards — there is
    // nothing to explain about a step that cannot be skipped.
    final canContinue = _accepted || !term.isRequired;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Text(
          'Permissão ${widget.step} de ${widget.total}',
          style: textTheme.labelSmall?.copyWith(color: AppColors.primary),
        ),
        const SizedBox(height: 8),

        Text(term.title, style: textTheme.titleLarge),
        const SizedBox(height: 4),
        Text(
          term.purpose,
          style: textTheme.bodyMedium?.copyWith(color: AppColors.foregroundMuted),
        ),
        const SizedBox(height: 16),

        if (term.isRequired)
          const ScreenMessage(message: 'Esta permissão é obrigatória para ser acompanhado.')
        else
          const ScreenMessage(
            message: 'Esta permissão é opcional. Você pode autorizar depois, quando quiser.',
          ),
        const SizedBox(height: 16),

        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surface,
            border: Border.all(color: AppColors.border),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(term.terms, style: textTheme.bodyMedium),
              const SizedBox(height: 16),

              // Which text was agreed to, on the screen that asks for it. What
              // ends up recorded is the version the API itself served
              // (`consent_terms.dart`).
              Text('Termo versão $currentTermsVersion', style: textTheme.labelSmall),
            ],
          ),
        ),
        const SizedBox(height: 8),

        CheckboxListTile(
          value: _accepted,
          onChanged: (value) => setState(() => _accepted = value ?? false),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
          title: Text('Li e autorizo: ${term.title.toLowerCase()}.', style: textTheme.bodyMedium),
        ),
        const SizedBox(height: 16),

        FilledButton(
          onPressed: canContinue ? () => widget.onAnswered(_accepted) : null,
          child: Text(_continueLabel(accepted: _accepted, isRequired: term.isRequired)),
        ),

        if (widget.onBack != null) ...<Widget>[
          const SizedBox(height: 8),
          TextButton(
            onPressed: widget.onBack,
            style: TextButton.styleFrom(foregroundColor: AppColors.foregroundMuted),
            child: const Text('Voltar'),
          ),
        ],
      ],
    );
  }
}

/// What the button says, which is the answer it is about to give. An optional
/// purpose left unticked is a "no" the patient should be able to read before
/// pressing it.
String _continueLabel({required bool accepted, required bool isRequired}) {
  if (accepted) return 'Autorizar e continuar';

  return isRequired ? 'Autorize para continuar' : 'Agora não, continuar';
}
