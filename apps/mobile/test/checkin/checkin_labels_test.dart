import 'package:fit_app/src/checkin/checkin_labels.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter_test/flutter_test.dart';

const List<CheckinScaleLabels> _scales = <CheckinScaleLabels>[
  energyLabels,
  sleepQualityLabels,
  hungerLabels,
];

void main() {
  test('there is a chip for every symptom the contract has', () {
    // A symptom the API gains and nobody writes a word for would be a symptom
    // the patient is never offered — or, worse, a chip that says
    // `muscle_soreness`.
    expect(checkinSymptomLabels.keys.toSet(), CheckinSymptom.values.toSet());
  });

  test('the chips are in the order the API declares them', () {
    // The order is the product's (`CHECKIN_SYMPTOMS` in the API's domain):
    // related complaints together, and `other` last because it is the escape
    // hatch.
    expect(checkinSymptomsInOrder.first, CheckinSymptom.bloating);
    expect(checkinSymptomsInOrder.last, CheckinSymptom.other);
    expect(checkinSymptomsInOrder, checkinSymptomLabels.keys.toList());
  });

  test('every symptom has a word, and none of them is a code', () {
    for (final symptom in checkinSymptomsInOrder) {
      final label = checkinSymptomLabel(symptom);

      expect(label.trim(), isNotEmpty, reason: '${symptom.name} has no label');
      expect(label, isNot(symptom.name), reason: '${symptom.name} shows its code');
    }
  });

  test('every scale asks something and answers in five words', () {
    for (final scale in _scales) {
      expect(scale.question.trim(), isNotEmpty);
      expect(scale.answers, hasLength(checkinScaleMax - checkinScaleMin + 1));

      for (final answer in scale.answers) {
        expect(answer.trim(), isNotEmpty);
      }
    }
  });

  test('a scale answers the word of each value, in order', () {
    expect(energyLabels.answerFor(checkinScaleMin), 'Muito baixa');
    expect(energyLabels.answerFor(checkinScaleMax), 'Muito boa');
    expect(energyLabels.answerFor(3), energyLabels.answers[2]);
  });

  test('a value off the scale is an empty word and never a crash', () {
    // The screen reads this while nothing is answered yet, and a check-in
    // screen that throws is a check-in nobody fills in.
    expect(energyLabels.answerFor(0), '');
    expect(energyLabels.answerFor(checkinScaleMax + 1), '');
  });

  test('the free fields stop where the contract stops', () {
    // The twins of `CHECKIN_OTHER_SYMPTOM_MAX_LENGTH` and
    // `CHECKIN_NOTE_MAX_LENGTH`. The API refuses past them with a 400; these
    // keep the field from letting somebody write a paragraph and lose it.
    expect(checkinOtherSymptomMaxLength, 80);
    expect(checkinNoteMaxLength, 500);
  });

  test('the five values of the scale are the ones the contract bounds', () {
    expect(checkinScaleValues, <int>[1, 2, 3, 4, 5]);
    expect(checkinScaleValues.first, checkinScaleMin);
    expect(checkinScaleValues.last, checkinScaleMax);
  });
}
