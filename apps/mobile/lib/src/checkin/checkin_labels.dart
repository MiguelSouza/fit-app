import 'package:fit_app_api_client/fit_app_api_client.dart';

/// The words of the check-in, in pt-BR (card P-02).
///
/// The API answers **codes and numbers**: a symptom is `bloating` and an energy
/// is `4`, and what either means to a person is the client's to say. That is
/// what keeps the history countable across a year and the screen translatable
/// — a sentence written by the API would be a sentence no client could
/// translate (`CLAUDE.md`, "Convenções": interface em pt-BR e pronta para
/// i18n).
///
/// The vocabulary itself is the contract's (`CheckinSymptom`, generated from the
/// OpenAPI document): the app invents no eleventh symptom, and a symptom the API
/// gains and nobody writes a word for is caught by the tests, not discovered by
/// a patient looking at a chip that says `muscle_soreness`.
///
/// **A scale is an order and not a quantity.** `4` of energy is the fourth of
/// five words below, and nothing in this app averages, adds or scores them: a
/// reading of these values is the professional's and the `insights` module's
/// (`CLAUDE.md`, "Saúde e LGPD": linguagem de apoio, nunca de diagnóstico).

/// The bottom and the top of every scale, as the contract bounds them.
const int checkinScaleMin = 1;
const int checkinScaleMax = 5;

/// Every answer of a scale, in order. What the row of taps is built from.
const List<int> checkinScaleValues = <int>[1, 2, 3, 4, 5];

/// The longest detail of `other` the API keeps, and the longest note.
///
/// They are the Dart twins of `CHECKIN_OTHER_SYMPTOM_MAX_LENGTH` and
/// `CHECKIN_NOTE_MAX_LENGTH` in `packages/contracts`, the same way
/// `currentTermsVersion` is the twin of the API's: the bounds are in the
/// OpenAPI document as `maxLength`, and the Dart generator does not carry them
/// into a constant the app could read.
///
/// The refusal that counts is the API's 400, for every client. These are here
/// so the field stops at the bound instead of letting somebody write a
/// paragraph and lose it on the round trip.
const int checkinOtherSymptomMaxLength = 80;
const int checkinNoteMaxLength = 500;

/// One scale: what it asks, and the five words of its answers.
class CheckinScaleLabels {
  const CheckinScaleLabels({required this.question, required this.answers});

  /// The question, as the patient reads it above the row.
  final String question;

  /// The five answers, from 1 to 5 — the index is the value minus one.
  final List<String> answers;

  /// The word for one value, or an empty string for a value off the scale.
  String answerFor(int value) {
    if (value < checkinScaleMin || value > checkinScaleMax) return '';

    return answers[value - checkinScaleMin];
  }
}

/// How much energy the patient felt they had.
const CheckinScaleLabels energyLabels = CheckinScaleLabels(
  question: 'Sua energia hoje',
  answers: <String>['Muito baixa', 'Baixa', 'Média', 'Boa', 'Muito boa'],
);

/// What the patient *thought* of their night — not what a wearable measured.
/// The two live side by side and neither corrects the other.
const CheckinScaleLabels sleepQualityLabels = CheckinScaleLabels(
  question: 'Como você sentiu que dormiu',
  answers: <String>['Péssimo', 'Ruim', 'Razoável', 'Bom', 'Ótimo'],
);

/// How hungry the day was.
const CheckinScaleLabels hungerLabels = CheckinScaleLabels(
  question: 'Sua fome ao longo do dia',
  answers: <String>['Nenhuma', 'Pouca', 'Normal', 'Bastante', 'Muita'],
);

/// pt-BR for every symptom of the contract, in the order the chips show.
///
/// The order is the API's own (`CHECKIN_SYMPTOMS` in
/// `apps/api/src/modules/health/domain/checkin.ts`): related complaints
/// together, and `other` last because it is the escape hatch.
const Map<CheckinSymptom, String> checkinSymptomLabels = <CheckinSymptom, String>{
  CheckinSymptom.bloating: 'Inchaço',
  CheckinSymptom.nausea: 'Náusea',
  CheckinSymptom.heartburn: 'Azia',
  CheckinSymptom.constipation: 'Intestino preso',
  CheckinSymptom.diarrhea: 'Diarreia',
  CheckinSymptom.headache: 'Dor de cabeça',
  CheckinSymptom.cramps: 'Cãibra',
  CheckinSymptom.muscleSoreness: 'Dor muscular',
  CheckinSymptom.dizziness: 'Tontura',
  CheckinSymptom.other: 'Outro',
};

/// The symptoms the screen offers, in the order above.
///
/// Read off the map and not written twice: a symptom with a word is a symptom
/// with a chip, and there is no way for the two lists to disagree.
List<CheckinSymptom> get checkinSymptomsInOrder =>
    checkinSymptomLabels.keys.toList(growable: false);

/// The word for a symptom. A symptom the contract gains and nobody translates
/// shows its code, which is visible and harmless — never a crash on the
/// patient's check-in screen, the same choice the home screen makes for a role.
String checkinSymptomLabel(CheckinSymptom symptom) =>
    checkinSymptomLabels[symptom] ?? symptom.name;
