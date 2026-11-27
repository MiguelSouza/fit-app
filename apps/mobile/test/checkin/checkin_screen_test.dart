import 'package:fit_app/src/api/api_failure.dart';
import 'package:fit_app/src/checkin/checkin_api.dart';
import 'package:fit_app/src/checkin/checkin_day.dart';
import 'package:fit_app/src/checkin/checkin_labels.dart';
import 'package:fit_app/src/checkin/checkin_screen.dart';
import 'package:fit_app/src/core/theme/app_theme.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// One save, as the test recorded it.
class _Saved {
  const _Saved({required this.day, required this.answers});

  final String day;
  final RecordCheckinRequest answers;
}

/// What the API answers, built from the generated model: the test speaks the
/// contract, like the screen does. No patient is invented — the values are a
/// synthetic day (`CLAUDE.md`, "Testes").
Checkin _checkin({
  int energy = 3,
  int sleepQuality = 3,
  int hunger = 3,
  List<CheckinSymptom> symptoms = const <CheckinSymptom>[],
  String? otherSymptom,
  String? note,
}) {
  return Checkin(
    (b) => b
      ..date = checkinDayOf()
      ..energy = energy
      ..sleepQuality = sleepQuality
      ..hunger = hunger
      ..symptoms.replace(symptoms)
      ..otherSymptom = otherSymptom
      ..note = note
      ..recordedAt = DateTime.utc(2026, 11, 27, 12)
      ..updatedAt = DateTime.utc(2026, 11, 27, 12),
  );
}

/// Puts the check-in screen on screen with the two things it talks to: what the
/// day already has, and what happens when it is saved. No network, no session.
///
/// The viewport is made tall on purpose. The default test window is 800 by 600
/// and the screen is a scrolling form, so a button below the fold would make
/// every `tap` here a test about scrolling instead of about the check-in. What
/// fits on a real phone is a question for a device, not for a widget test.
Future<List<_Saved>> pumpCheckin(
  WidgetTester tester, {
  Future<Checkin?> Function()? today,
  Future<Checkin> Function(String day, RecordCheckinRequest answers)? onSave,
}) async {
  final saves = <_Saved>[];

  final readToday = today ?? () async => null;
  final save = onSave ?? (String day, RecordCheckinRequest answers) async => _checkin();

  tester.view.physicalSize = const Size(1200, 4000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        todayCheckinProvider.overrideWith((ref) => readToday()),
        saveCheckinProvider.overrideWithValue(
          ({required String day, required RecordCheckinRequest answers}) {
            saves.add(_Saved(day: day, answers: answers));

            return save(day, answers);
          },
        ),
      ],
      child: MaterialApp(theme: AppTheme.dark, home: const CheckinScreen()),
    ),
  );

  await tester.pumpAndSettle();

  return saves;
}

FilledButton _saveButton(WidgetTester tester) =>
    tester.widget<FilledButton>(find.byType(FilledButton));

/// Taps the nth option of a scale, counting from one. The scales are in the
/// order the screen shows them: energy, sleep, hunger.
Future<void> tapScale(WidgetTester tester, int scale, int value) async {
  await tester.tap(find.text('$value').at(scale - 1));
  await tester.pump();
}

/// Answers the three scales, which is the whole of a day with nothing to
/// report.
Future<void> answerTheThreeScales(WidgetTester tester) async {
  await tapScale(tester, 1, 4);
  await tapScale(tester, 2, 3);
  await tapScale(tester, 3, 2);
}

void main() {
  testWidgets('three taps and a save is the whole check-in', (tester) async {
    final saves = await pumpCheckin(tester);

    // The acceptance criterion of card P-02 as a count: nothing is typed, and
    // the button is the fourth touch.
    expect(_saveButton(tester).onPressed, isNull);

    await answerTheThreeScales(tester);

    expect(_saveButton(tester).onPressed, isNotNull);

    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(saves, hasLength(1));
    expect(saves.single.day, checkinDayOf());
    expect(saves.single.answers.energy, 4);
    expect(saves.single.answers.sleepQuality, 3);
    expect(saves.single.answers.hunger, 2);
    expect(saves.single.answers.symptoms, isEmpty);
    expect(saves.single.answers.note, isNull);
  });

  testWidgets('nothing is saved while a scale is unanswered', (tester) async {
    final saves = await pumpCheckin(tester);

    await tapScale(tester, 1, 5);
    await tapScale(tester, 2, 5);

    expect(_saveButton(tester).onPressed, isNull);

    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(saves, isEmpty);
  });

  testWidgets('the word of the answer is on the screen, not just the number', (tester) async {
    await pumpCheckin(tester);

    await tapScale(tester, 1, 5);

    expect(find.text(energyLabels.answerFor(5)), findsOne);
  });

  testWidgets('a symptom is one tap, and nothing chosen is nothing sent', (tester) async {
    final saves = await pumpCheckin(tester);

    await answerTheThreeScales(tester);
    await tester.tap(find.text(checkinSymptomLabel(CheckinSymptom.nausea)));
    await tester.pump();

    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(saves.single.answers.symptoms?.toList(), <CheckinSymptom>[CheckinSymptom.nausea]);
  });

  testWidgets('tapping a chosen symptom takes it out again', (tester) async {
    final saves = await pumpCheckin(tester);

    await answerTheThreeScales(tester);

    final chip = find.text(checkinSymptomLabel(CheckinSymptom.headache));

    await tester.tap(chip);
    await tester.pump();
    await tester.tap(chip);
    await tester.pump();

    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(saves.single.answers.symptoms, isEmpty);
  });

  testWidgets('the field for `other` only exists next to the chip', (tester) async {
    await pumpCheckin(tester);

    expect(find.text('O que foi?'), findsNothing);

    await tester.tap(find.text(checkinSymptomLabel(CheckinSymptom.other)));
    await tester.pump();

    expect(find.text('O que foi?'), findsOne);
  });

  testWidgets('opens on the check-in of the day, so it can be corrected', (tester) async {
    // "Editável no mesmo dia" is this: the same form, prefilled, and the same
    // button.
    final saves = await pumpCheckin(
      tester,
      today: () async => _checkin(
        energy: 1,
        sleepQuality: 2,
        hunger: 5,
        symptoms: <CheckinSymptom>[CheckinSymptom.cramps],
        note: 'treino pesado',
      ),
    );

    expect(find.text(energyLabels.answerFor(1)), findsOne);
    expect(find.text('treino pesado'), findsOne);
    expect(find.text('Salvar correção'), findsOne);

    // One tap changes one answer and the rest is what was already there.
    await tapScale(tester, 1, 4);
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(saves.single.answers.energy, 4);
    expect(saves.single.answers.hunger, 5);
    expect(saves.single.answers.symptoms?.toList(), <CheckinSymptom>[CheckinSymptom.cramps]);
    expect(saves.single.answers.note, 'treino pesado');
  });

  testWidgets('a day with nothing in it opens empty and offers the first save', (tester) async {
    await pumpCheckin(tester, today: () async => null);

    expect(_saveButton(tester).onPressed, isNull);
    expect(find.text('Salvar check-in'), findsOne);
  });

  testWidgets('a day that could not be read is still a day that can be written', (tester) async {
    // The form stays usable: whether the save goes through is the API's answer,
    // not this screen's guess.
    final saves = await pumpCheckin(
      tester,
      today: () async => throw const ApiFailure(message: 'Não foi possível falar com a API.'),
    );

    await answerTheThreeScales(tester);
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(saves, hasLength(1));
  });

  testWidgets('what the API refused is what the screen says', (tester) async {
    const refusal =
        'O check-in é preenchido e corrigido no próprio dia. Esse dia já passou — conte o '
        'que precisar na nota do check-in de hoje.';

    await pumpCheckin(
      tester,
      onSave: (day, answers) async =>
          throw const ApiFailure(message: refusal, code: 'health.checkin.window_closed'),
    );

    await answerTheThreeScales(tester);
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    // The API's own message, in the API's own words: the app writes no second
    // opinion about a rule it does not own.
    expect(find.text(refusal), findsOne);
  });

  testWidgets('a save that worked says so, and leaves the form open', (tester) async {
    await pumpCheckin(tester);

    await answerTheThreeScales(tester);
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle();

    expect(find.text('Check-in salvo. Você pode corrigir até o fim do dia.'), findsOne);
    expect(_saveButton(tester).onPressed, isNotNull);
    expect(find.text('Salvar correção'), findsOne);
  });

  testWidgets('says which day it is about', (tester) async {
    await pumpCheckin(tester);

    expect(find.textContaining(checkinDayLabel(checkinDayOf())), findsOne);
  });
}
