import 'package:fit_app/src/core/theme/app_theme.dart';
import 'package:fit_app/src/invitation/consent_page.dart';
import 'package:fit_app/src/invitation/consent_terms.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

final ConsentTerm _required = invitationConsentTerms.firstWhere((term) => term.isRequired);
final ConsentTerm _optional = invitationConsentTerms.firstWhere((term) => !term.isRequired);

/// One consent screen, on its own: no session, no API and no flow around it.
/// What it answers is the only thing it decides.
Future<List<bool>> pumpConsent(WidgetTester tester, ConsentTerm term) async {
  final answers = <bool>[];

  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.dark,
      home: Scaffold(
        body: SingleChildScrollView(
          child: ConsentPage(term: term, step: 1, total: 4, onAnswered: answers.add),
        ),
      ),
    ),
  );

  return answers;
}

FilledButton _button(WidgetTester tester) => tester.widget<FilledButton>(find.byType(FilledButton));

void main() {
  testWidgets('a required purpose has no way forward until it is authorised', (tester) async {
    final answers = await pumpConsent(tester, _required);

    // The acceptance criterion of card P-01: there is no button that advances.
    expect(_button(tester).onPressed, isNull);

    await tester.tap(find.byType(FilledButton));
    await tester.pump();

    expect(answers, isEmpty);
  });

  testWidgets('ticking the box is what opens the way, and the answer is yes', (tester) async {
    final answers = await pumpConsent(tester, _required);

    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();

    expect(_button(tester).onPressed, isNotNull);

    await tester.tap(find.byType(FilledButton));
    await tester.pump();

    expect(answers, <bool>[true]);
  });

  testWidgets('an optional purpose can be declined, and the flow goes on', (tester) async {
    final answers = await pumpConsent(tester, _optional);

    expect(_button(tester).onPressed, isNotNull);

    await tester.tap(find.byType(FilledButton));
    await tester.pump();

    expect(answers, <bool>[false]);
  });

  testWidgets('the text of the term and its version are on the screen', (tester) async {
    await pumpConsent(tester, _required);

    expect(find.text(_required.terms), findsOne);
    expect(find.text('Termo versão $currentTermsVersion'), findsOne);
    expect(find.text(_required.title), findsOne);
  });

  testWidgets('a purpose already answered comes back answered', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark,
        home: Scaffold(
          body: SingleChildScrollView(
            child: ConsentPage(
              term: _optional,
              step: 3,
              total: 4,
              initiallyAccepted: true,
              onAnswered: (_) {},
            ),
          ),
        ),
      ),
    );

    expect(tester.widget<CheckboxListTile>(find.byType(CheckboxListTile)).value, isTrue);
  });
}
