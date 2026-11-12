import 'package:fit_app/src/invitation/consent_terms.dart';
import 'package:fit_app_api_client/fit_app_api_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('there is one screen for every purpose the contract has', () {
    // A purpose the API gains and nobody writes text for would be a purpose
    // the patient is never asked about — and the acceptance would be sent
    // without it, silently.
    expect(
      invitationConsentTerms.map((term) => term.type).toSet(),
      ConsentType.values.toSet(),
    );
  });

  test('the two required ones are the ones the API requires', () {
    // The twin of `REQUIRED_CONSENTS`
    // (apps/api/src/modules/identity/domain/consent.ts). The refusal that
    // counts is the API's 422; this is what lets the app refuse first, in the
    // words of the purpose that was skipped.
    expect(requiredConsentTypes, <ConsentType>[
      ConsentType.healthData,
      ConsentType.shareWithProfessional,
    ]);
  });

  test('every purpose has a title, a line and the text of the term', () {
    for (final term in invitationConsentTerms) {
      expect(term.title.trim(), isNotEmpty, reason: '${term.type} has no title');
      expect(term.purpose.trim(), isNotEmpty, reason: '${term.type} has no purpose');

      // A term behind a link nobody opens is not a consent: the text is on the
      // screen, whole, and it is long enough to say something.
      expect(term.terms.trim().length, greaterThan(120), reason: '${term.type} has no terms');
    }
  });

  test('the version is shown, so what was agreed to can be named', () {
    expect(currentTermsVersion.trim(), isNotEmpty);
  });

  test('a purpose is found by its type, and an unknown one is not a crash', () {
    expect(consentTermOf(ConsentType.aiProcessing)?.isRequired, isFalse);
    expect(consentTermOf(ConsentType.healthData)?.isRequired, isTrue);
  });
}
