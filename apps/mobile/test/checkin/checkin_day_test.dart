import 'package:fit_app/src/checkin/checkin_day.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('checkinDayOf', () {
    test('answers the local day, padded, as the API takes it', () {
      // A local `DateTime`: whatever zone the machine running this is in, the
      // three numbers are its own.
      expect(checkinDayOf(DateTime(2026, 11, 27, 15, 30)), '2026-11-27');
      expect(checkinDayOf(DateTime(2026, 1, 7)), '2026-01-07');
    });

    test('reads an instant in the local zone and not in UTC', () {
      // The day of a check-in is the day the person lived, so what counts is
      // the local reading of the instant — which is exactly what the API does
      // with the zone on the profile (`CLAUDE.md`, "Dados de saúde").
      final instant = DateTime.utc(2026, 11, 27, 2);

      expect(checkinDayOf(instant), checkinDayOf(instant.toLocal()));
    });

    test('says today when nobody says otherwise', () {
      final now = DateTime.now();

      expect(checkinDayOf(), checkinDayOf(now));
    });
  });

  group('checkinDayLabel', () {
    test('shows the day and the month, in that order', () {
      expect(checkinDayLabel('2026-11-27'), '27/11');
      expect(checkinDayLabel('2026-01-07'), '07/01');
    });

    test('leaves anything that is not a day alone, instead of guessing', () {
      expect(checkinDayLabel('hoje'), 'hoje');
      expect(checkinDayLabel(''), '');
    });
  });
}
