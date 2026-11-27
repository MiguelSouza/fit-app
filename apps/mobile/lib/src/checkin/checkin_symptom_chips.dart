import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter/material.dart';

import '../core/theme/app_colors.dart';
import 'checkin_labels.dart';

/// The symptoms of the day, as chips (card P-02).
///
/// Chips and not a list of checkboxes: nothing here is required, most days
/// nothing is chosen, and a wrapped row of words is read at a glance and left
/// alone — a list of ten rows would turn "nada a relatar" into scrolling.
///
/// **Nothing chosen means "nada a relatar".** There is no "sem sintomas" chip
/// and no third state: the check-in that exists is the one that was filled in,
/// and the API reads an absent list exactly that way.
///
/// `other` is the escape hatch the card asks for ("lista de opções + outro").
/// Choosing it opens the one short field on this screen; what is typed there is
/// the name of a symptom, and the story of the day is the note below.
///
/// It holds no state: what is chosen is the screen's.
class CheckinSymptomChips extends StatelessWidget {
  const CheckinSymptomChips({required this.chosen, required this.onToggled, super.key});

  final Set<CheckinSymptom> chosen;

  /// One symptom was tapped. Whether that put it in or took it out is the
  /// screen's to decide, which is what keeps this widget stateless.
  final ValueChanged<CheckinSymptom> onToggled;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: <Widget>[
        for (final symptom in checkinSymptomsInOrder)
          FilterChip(
            label: Text(checkinSymptomLabel(symptom)),
            selected: chosen.contains(symptom),
            onSelected: (_) => onToggled(symptom),
            showCheckmark: false,
            backgroundColor: AppColors.surface,
            selectedColor: AppColors.primary,
            side: BorderSide(
              color: chosen.contains(symptom) ? AppColors.primary : AppColors.border,
            ),
            labelStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: chosen.contains(symptom) ? AppColors.onPrimary : AppColors.foreground,
            ),
          ),
      ],
    );
  }
}
