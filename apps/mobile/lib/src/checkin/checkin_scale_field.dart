import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';
import 'checkin_labels.dart';

/// One scale of the check-in: a question and five targets, answered with one
/// tap (card P-02).
///
/// **One tap and no dragging.** A slider looks right for a 1 to 5 and is the
/// wrong control for this screen: it takes a press, a drag and a release to
/// answer, it answers wrongly when a thumb slips, and it cannot be read by a
/// screen reader as five options. Five buttons are three taps for the whole
/// check-in, which is the card's criterion ("menos de 15 segundos") decided in
/// the layout rather than hoped for.
///
/// The targets are 48 logical pixels tall, which is the minimum both platforms
/// ask of anything a finger hits, and each one carries the **word** of its
/// value as its accessibility label — "Boa", not "4": a person using
/// TalkBack is choosing between words, like everybody else.
///
/// It holds no state. What was answered, and what to do with it, are the
/// screen's (`checkin_screen.dart`).
class CheckinScaleField extends StatelessWidget {
  const CheckinScaleField({
    required this.labels,
    required this.value,
    required this.onChanged,
    super.key,
  });

  /// The question and the five words of this scale.
  final CheckinScaleLabels labels;

  /// What is answered, or `null` while nothing is.
  final int? value;

  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;
    final answered = value;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: <Widget>[
            Text(labels.question, style: textTheme.bodyMedium),

            // The word of the answer, next to the question: the number on the
            // button is how it is chosen, the word is what it means.
            Text(
              answered == null ? '' : labels.answerFor(answered),
              style: textTheme.labelSmall?.copyWith(color: AppColors.primary),
            ),
          ],
        ),
        const SizedBox(height: 8),

        Row(
          children: <Widget>[
            for (final option in checkinScaleValues)
              Expanded(
                child: Padding(
                  padding: EdgeInsets.only(right: option == checkinScaleMax ? 0 : 8),
                  child: _Option(
                    value: option,
                    word: labels.answerFor(option),
                    chosen: option == answered,
                    onTap: () => onChanged(option),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({
    required this.value,
    required this.word,
    required this.chosen,
    required this.onTap,
  });

  final int value;
  final String word;
  final bool chosen;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      // The word and not the number: what is being chosen is "Boa".
      label: word,
      inMutuallyExclusiveGroup: true,
      selected: chosen,
      button: true,
      child: Material(
        color: chosen ? AppColors.primary : AppColors.surface,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              border: Border.all(color: chosen ? AppColors.primary : AppColors.border),
              borderRadius: BorderRadius.circular(10),
            ),
            child: ExcludeSemantics(
              child: Text(
                '$value',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: chosen ? AppColors.onPrimary : AppColors.foreground,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
