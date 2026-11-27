import {
  assertCheckinWindowIsOpen,
  checkinDateIn,
  checkinDateOf,
  checkinPeriod,
  checkinToRecord,
  daysInPeriod,
  isCheckinWindowOpen,
  symptomsInVocabularyOrder,
  CHECKIN_SYMPTOMS,
  MAX_CHECKIN_PERIOD_DAYS,
  type CheckinAnswers,
} from './checkin';
import {
  CheckinPeriodTooLongError,
  CheckinWindowClosedError,
  InvalidCheckinDateError,
  InvalidCheckinPeriodError,
} from './health-errors';

/**
 * The rules of the daily check-in, as unit tests (CLAUDE.md, "Testes":
 * `domain/` is mandatory).
 *
 * No database, no NestJS and no patient: the ids are literals and the values
 * are the ones a synthetic patient would answer (CLAUDE.md — nunca dados reais
 * em dev ou teste).
 */
const PATIENT = '11111111-1111-4111-8111-111111111111';

const SAO_PAULO = 'America/Sao_Paulo';
const LISBON = 'Europe/Lisbon';

const SAVED_AT = new Date('2026-11-27T15:00:00.000Z');

function answers(overrides: Partial<CheckinAnswers> = {}): CheckinAnswers {
  return { energy: 3, sleepQuality: 4, hunger: 2, symptoms: [], ...overrides };
}

describe('the date of a check-in', () => {
  it('accepts a day of the calendar', () => {
    expect(checkinDateOf('2026-11-27')).toBe('2026-11-27');
    expect(checkinDateOf('2024-02-29')).toBe('2024-02-29');
  });

  it('refuses digits that name no day', () => {
    // The pattern matches all three. February has no 31st, November no 31st,
    // and 2026 is not a leap year.
    expect(() => checkinDateOf('2026-02-31')).toThrow(InvalidCheckinDateError);
    expect(() => checkinDateOf('2026-11-31')).toThrow(InvalidCheckinDateError);
    expect(() => checkinDateOf('2026-02-29')).toThrow(InvalidCheckinDateError);
  });

  it('refuses anything that is not YYYY-MM-DD', () => {
    expect(() => checkinDateOf('27/11/2026')).toThrow(InvalidCheckinDateError);
    expect(() => checkinDateOf('2026-11-27T00:00:00.000Z')).toThrow(InvalidCheckinDateError);
    expect(() => checkinDateOf('2026-1-7')).toThrow(InvalidCheckinDateError);
    expect(() => checkinDateOf('')).toThrow(InvalidCheckinDateError);
  });
});

describe('which day it is for the patient', () => {
  it('reads the day in the zone on their profile, not in UTC', () => {
    // Three in the morning in UTC is still the 26th in São Paulo, which is the
    // whole reason the zone is on the profile (CLAUDE.md, "Dados de saúde").
    const lateNight = new Date('2026-11-27T02:00:00.000Z');

    expect(checkinDateIn(SAO_PAULO, lateNight)).toBe('2026-11-26');
    expect(checkinDateIn('UTC', lateNight)).toBe('2026-11-27');
  });

  it('reads it ahead of UTC for a patient who is ahead', () => {
    // Half past eleven at night in UTC is already the next day in Tokyo.
    const night = new Date('2026-11-27T23:30:00.000Z');

    expect(checkinDateIn('Asia/Tokyo', night)).toBe('2026-11-28');
  });

  it('pads the month and the day to two digits', () => {
    expect(checkinDateIn('UTC', new Date('2026-01-07T12:00:00.000Z'))).toBe('2026-01-07');
  });

  it('is a bug, not a refusal, when the zone is not a zone', () => {
    expect(() => checkinDateIn('Mars/Olympus_Mons', SAVED_AT)).toThrow(/time zone/u);
  });
});

describe('the window a check-in may be written in', () => {
  // Noon in São Paulo on the 27th.
  const now = new Date('2026-11-27T15:00:00.000Z');

  it('is open on the patient own today', () => {
    expect(isCheckinWindowOpen('2026-11-27', SAO_PAULO, now)).toBe(true);
    expect(() => assertCheckinWindowIsOpen('2026-11-27', SAO_PAULO, now)).not.toThrow();
  });

  it('is closed on yesterday: a check-in is corrected on its own day', () => {
    expect(isCheckinWindowOpen('2026-11-26', SAO_PAULO, now)).toBe(false);
    expect(() => assertCheckinWindowIsOpen('2026-11-26', SAO_PAULO, now)).toThrow(
      CheckinWindowClosedError,
    );
  });

  it('is closed on tomorrow, which has not happened', () => {
    expect(isCheckinWindowOpen('2026-11-28', SAO_PAULO, now)).toBe(false);
  });

  it('follows the patient zone and not the server', () => {
    // Half past midnight in UTC on the 28th: still the 27th in São Paulo and
    // already the 28th in Lisbon. The same instant, two open days.
    const afterMidnight = new Date('2026-11-28T00:30:00.000Z');

    expect(isCheckinWindowOpen('2026-11-27', SAO_PAULO, afterMidnight)).toBe(true);
    expect(isCheckinWindowOpen('2026-11-27', LISBON, afterMidnight)).toBe(false);
    expect(isCheckinWindowOpen('2026-11-28', LISBON, afterMidnight)).toBe(true);
  });
});

describe('the record written for a check-in', () => {
  it('carries the patient, the day, the three scales and the instant', () => {
    expect(checkinToRecord(PATIENT, '2026-11-27', answers(), SAVED_AT)).toEqual({
      patientProfileId: PATIENT,
      date: '2026-11-27',
      energy: 3,
      sleepQuality: 4,
      hunger: 2,
      symptoms: [],
      otherSymptom: null,
      note: null,
      savedAt: SAVED_AT,
    });
  });

  it('puts the symptoms in the order of the vocabulary, each one once', () => {
    const record = checkinToRecord(
      PATIENT,
      '2026-11-27',
      answers({ symptoms: ['headache', 'bloating', 'headache', 'nausea'] }),
      SAVED_AT,
    );

    expect(record.symptoms).toEqual(['bloating', 'nausea', 'headache']);
  });

  it('keeps the detail of `other`, trimmed', () => {
    const record = checkinToRecord(
      PATIENT,
      '2026-11-27',
      answers({ symptoms: ['other'], otherSymptom: '  queimação no peito  ' }),
      SAVED_AT,
    );

    expect(record.otherSymptom).toBe('queimação no peito');
  });

  it('drops the detail when `other` was not chosen', () => {
    const record = checkinToRecord(
      PATIENT,
      '2026-11-27',
      answers({ symptoms: ['nausea'], otherSymptom: 'algo' }),
      SAVED_AT,
    );

    expect(record.otherSymptom).toBeNull();
  });

  it('accepts `other` with nothing written: the chip alone says something', () => {
    const record = checkinToRecord(
      PATIENT,
      '2026-11-27',
      answers({ symptoms: ['other'] }),
      SAVED_AT,
    );

    expect(record.symptoms).toEqual(['other']);
    expect(record.otherSymptom).toBeNull();
  });

  it('turns a blank note into nothing at all, so there is one empty', () => {
    expect(
      checkinToRecord(PATIENT, '2026-11-27', answers({ note: '   ' }), SAVED_AT).note,
    ).toBeNull();
    expect(
      checkinToRecord(PATIENT, '2026-11-27', answers({ note: ' dia corrido ' }), SAVED_AT).note,
    ).toBe('dia corrido');
  });

  it('refuses a day that is not a day', () => {
    expect(() => checkinToRecord(PATIENT, '2026-02-31', answers(), SAVED_AT)).toThrow(
      InvalidCheckinDateError,
    );
  });

  it('is a bug when a scale is off the scale, and says which field', () => {
    expect(() => checkinToRecord(PATIENT, '2026-11-27', answers({ energy: 0 }), SAVED_AT)).toThrow(
      /energy/u,
    );
    expect(() => checkinToRecord(PATIENT, '2026-11-27', answers({ hunger: 6 }), SAVED_AT)).toThrow(
      /hunger/u,
    );
    expect(() =>
      checkinToRecord(PATIENT, '2026-11-27', answers({ sleepQuality: 2.5 }), SAVED_AT),
    ).toThrow(/sleepQuality/u);
  });

  it('is a bug when nobody says whose check-in it is', () => {
    expect(() => checkinToRecord('   ', '2026-11-27', answers(), SAVED_AT)).toThrow(/profile id/u);
  });
});

describe('the symptoms, normalized', () => {
  it('answers an empty list for nothing reported', () => {
    expect(symptomsInVocabularyOrder([])).toEqual([]);
  });

  it('keeps the vocabulary order whatever order it is given', () => {
    expect(symptomsInVocabularyOrder([...CHECKIN_SYMPTOMS].reverse())).toEqual([
      ...CHECKIN_SYMPTOMS,
    ]);
  });
});

describe('the period of a listing', () => {
  it('accepts one day, both ends the same', () => {
    expect(checkinPeriod('2026-11-27', '2026-11-27')).toEqual({
      from: '2026-11-27',
      to: '2026-11-27',
    });
    expect(daysInPeriod({ from: '2026-11-27', to: '2026-11-27' })).toBe(1);
  });

  it('counts both ends in', () => {
    expect(daysInPeriod({ from: '2026-11-01', to: '2026-11-30' })).toBe(30);
  });

  it('is unmoved by daylight saving: the arithmetic is in UTC', () => {
    // Brazil has no DST today and Europe does; either way these are plain days.
    expect(daysInPeriod({ from: '2026-03-28', to: '2026-03-30' })).toBe(3);
    expect(daysInPeriod({ from: '2026-10-24', to: '2026-10-26' })).toBe(3);
  });

  it('refuses a period that runs backwards', () => {
    expect(() => checkinPeriod('2026-11-27', '2026-11-26')).toThrow(InvalidCheckinPeriodError);
  });

  it('accepts the longest period and refuses one day more', () => {
    // 2026-01-01 plus 365 days is 2027-01-01: 366 days with both ends in.
    expect(() => checkinPeriod('2026-01-01', '2027-01-01')).not.toThrow();
    expect(daysInPeriod({ from: '2026-01-01', to: '2027-01-01' })).toBe(MAX_CHECKIN_PERIOD_DAYS);

    expect(() => checkinPeriod('2026-01-01', '2027-01-02')).toThrow(CheckinPeriodTooLongError);
  });

  it('refuses an end that is not a day', () => {
    expect(() => checkinPeriod('2026-11-01', '2026-11-31')).toThrow(InvalidCheckinDateError);
    expect(() => checkinPeriod('ontem', '2026-11-27')).toThrow(InvalidCheckinDateError);
  });
});
