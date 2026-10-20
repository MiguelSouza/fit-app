import type { ProfileId } from './profiles.ts';
import { round } from './random.ts';
import type { SyntheticPatient } from './records.ts';
import { dateMinusDays, daysBetween, type LocalDate } from './time.ts';

/**
 * The handful of numbers that make a profile visible.
 *
 * This is the acceptance criterion "cada perfil problemático é identificável a
 * olho nos dados", and it is here rather than in the test because the two uses
 * have to agree: `pnpm seed:synthetic` prints this table at the end of a run,
 * and `test/profiles.test.ts` asserts the detectors below on the same numbers.
 * If a profile stops being visible, the run shows it and the test fails for
 * the same reason.
 *
 * Every number compares the start of the window against its end — three weeks
 * against three weeks, which is long enough for the day to day noise to
 * average out of the way and short enough to still be a trend.
 */

/** The width of the two windows that get compared, in days. */
const WINDOW_DAYS = 21;

export interface PatientSummary {
  readonly code: string;
  readonly id: string;
  readonly profile: ProfileId;

  /**
   * How many days the window this summary read is. Carried here because a
   * detector written in days of silence cannot be read without it: three weeks
   * without a check-in is a lot of a 90-day window and more than all of a
   * three-week one.
   */
  readonly windowDays: number;

  /** From the first weigh-in of the window to the last, in percent. */
  readonly weightChangePct: number | null;

  /** Mean nightly sleep of the last window minus that of the first, in minutes. */
  readonly sleepChangeMin: number | null;

  /** Training minutes of the last window over those of the first, in percent. */
  readonly trainingChangePct: number | null;

  /** Resting heart rate of the last window minus that of the first, in bpm. */
  readonly restingHrChangeBpm: number | null;

  /** Heart rate variability of the last window over the first, in percent. */
  readonly hrvChangePct: number | null;

  /** Mean share of the planned meals logged, over the last window. */
  readonly mealAdherencePct: number | null;

  /** Last window minus first window, in percentage points. */
  readonly mealAdherenceChangePts: number | null;

  /** Mean energy adherence over the last window, in percent. */
  readonly energyAdherencePct: number | null;

  /** Mean of the check-in energy score over the whole window. */
  readonly energyScoreMean: number | null;

  readonly checkInCount: number;

  /** Days between the last check-in and the end of the window. */
  readonly daysSinceLastCheckIn: number;
}

/** Mean of a list, or null when there is nothing to average. */
function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;

  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** `left - right`, rounded, or null when either side is missing. */
function change(left: number | null, right: number | null, decimals = 0): number | null {
  if (left === null || right === null) return null;

  return round(left - right, decimals);
}

/** `left` over `right` as a percentage change, or null when either is missing. */
function changePct(left: number | null, right: number | null): number | null {
  if (left === null || right === null || right === 0) return null;

  return round(((left - right) / right) * 100, 1);
}

/**
 * Reduces one patient's 90 days to the table above.
 *
 * @param endDate the last day of the window, as the run was asked for
 * @param days the width of the window
 */
export function summarize(
  patient: SyntheticPatient,
  endDate: LocalDate,
  days: number,
): PatientSummary {
  // On a window too short for two separate three-week halves, they shrink
  // rather than overlap: an overlapping comparison would understate every
  // trend, and silently.
  const window = Math.min(WINDOW_DAYS, Math.floor(days / 3));
  const firstEnds = dateMinusDays(endDate, days - window);
  const lastStarts = dateMinusDays(endDate, window - 1);

  const inFirst = (date: LocalDate): boolean => date <= firstEnds;
  const inLast = (date: LocalDate): boolean => date >= lastStarts;

  const { sleep, activities, dailyMetrics, checkIns, weights, adherence } = patient.series;

  const sleepFirst = mean(sleep.filter((n) => inFirst(n.nightOf)).map((n) => n.durationMin));
  const sleepLast = mean(sleep.filter((n) => inLast(n.nightOf)).map((n) => n.durationMin));

  const trainingFirst = activities
    .filter((one) => inFirst(one.localDate))
    .reduce((total, one) => total + one.durationMin, 0);
  const trainingLast = activities
    .filter((one) => inLast(one.localDate))
    .reduce((total, one) => total + one.durationMin, 0);

  const restingFirst = mean(
    dailyMetrics.filter((day) => inFirst(day.localDate)).map((day) => day.restingHeartRateBpm),
  );
  const restingLast = mean(
    dailyMetrics.filter((day) => inLast(day.localDate)).map((day) => day.restingHeartRateBpm),
  );

  const hrvFirst = mean(
    dailyMetrics.filter((day) => inFirst(day.localDate)).map((day) => day.hrvMs),
  );
  const hrvLast = mean(dailyMetrics.filter((day) => inLast(day.localDate)).map((day) => day.hrvMs));

  const adherenceFirst = mean(
    adherence.filter((day) => inFirst(day.localDate)).map((day) => day.mealAdherencePct),
  );
  const adherenceLast = mean(
    adherence.filter((day) => inLast(day.localDate)).map((day) => day.mealAdherencePct),
  );

  const firstWeight = weights.at(0);
  const lastWeight = weights.at(-1);
  const lastCheckIn = checkIns.at(-1);

  return {
    code: patient.code,
    id: patient.id,
    profile: patient.profile,
    windowDays: days,

    weightChangePct:
      firstWeight === undefined || lastWeight === undefined || weights.length < 2
        ? null
        : round(((lastWeight.weightKg - firstWeight.weightKg) / firstWeight.weightKg) * 100, 1),

    sleepChangeMin: change(sleepLast, sleepFirst),
    trainingChangePct: changePct(trainingLast, trainingFirst),
    restingHrChangeBpm: change(restingLast, restingFirst, 1),
    hrvChangePct: changePct(hrvLast, hrvFirst),

    mealAdherencePct: adherenceLast === null ? null : round(adherenceLast),
    mealAdherenceChangePts: change(adherenceLast, adherenceFirst),

    energyAdherencePct: (() => {
      const value = mean(
        adherence.filter((day) => inLast(day.localDate)).map((day) => day.energyAdherencePct),
      );

      return value === null ? null : round(value);
    })(),

    energyScoreMean: (() => {
      const value = mean(checkIns.map((one) => one.energyScore));

      return value === null ? null : round(value, 2);
    })(),

    checkInCount: checkIns.length,

    daysSinceLastCheckIn:
      lastCheckIn === undefined ? days : daysBetween(lastCheckIn.localDate, endDate),
  };
}

/**
 * What a reader is supposed to see.
 *
 * One detector per problematic profile, written only in terms of the summary
 * above — so each one is a sentence somebody could check by looking at the
 * printed table, not a reference back to the profile that generated the data.
 * The test asserts both directions: every patient of a profile trips its own
 * detector, and no patient of `estavel` trips any of them. A profile that
 * stopped being visible would otherwise still "work".
 */
export interface Detector {
  /** The profile this is meant to catch. */
  readonly profile: ProfileId;

  /** What it looks for, in pt-BR: the sentence a reader checks the table against. */
  readonly looksFor: string;

  fires(summary: PatientSummary): boolean;
}

/**
 * How long a silence has to last to count as one, on a window of `days`.
 *
 * Three weeks is the answer that matters, and the only one on the 90 days the
 * card asks for. But `--days` goes down to three weeks, and a patient cannot
 * be silent for longer than the window they are read in: with a fixed 21 the
 * detector was unreachable on anything under 42 days, and `sumiu` — the one
 * profile whose whole signature is the silence — came out invisible on exactly
 * the windows where there is least data to see anything else in.
 *
 * Half the window is the floor, which is always reachable: the profile stops
 * answering a third of the way in, so the silence is the remaining two thirds
 * of any window, and two thirds is more than a half by a margin that the
 * check-in rate of a patient who is fine does not cross.
 */
function silenceThreshold(days: number): number {
  return Math.min(21, Math.ceil(days / 2));
}

export const DETECTORS: readonly Detector[] = [
  {
    profile: 'sobrecarga',
    looksFor: 'treino +30% ou mais e sono 35 min menor',
    // 30% and not 35%: the weekly volume cannot grow past what one session of
    // the patient's own sports may last (`ACTIVITY_SHAPES`), so a patient whose
    // mix is swimming and walking — 90 min a session — absorbs part of the
    // +90% the profile asks for, and lands around +33%. Over a sweep of 500
    // seeds that was the floor for `sobrecarga`, while no `estavel` patient
    // got past +25%; and the two conditions never come close together on a
    // patient who is fine, which is what makes the pair safe to loosen.
    fires: (summary) =>
      (summary.trainingChangePct ?? 0) >= 30 && (summary.sleepChangeMin ?? 0) <= -35,
  },
  {
    profile: 'perda-de-peso-nao-planejada',
    looksFor: 'peso −4% ou menos com adesão às refeições ainda acima de 60%',
    fires: (summary) =>
      (summary.weightChangePct ?? 0) <= -4 && (summary.mealAdherencePct ?? 0) >= 60,
  },
  {
    profile: 'adesao-em-queda',
    looksFor: 'adesão às refeições 25 pontos abaixo do início',
    fires: (summary) => (summary.mealAdherenceChangePts ?? 0) <= -25,
  },
  {
    profile: 'sumiu',
    looksFor: 'sem check-in há 21 dias, ou há mais de metade da janela',
    fires: (summary) => summary.daysSinceLastCheckIn >= silenceThreshold(summary.windowDays),
  },
  {
    profile: 'energia-baixa',
    // One condition, and on purpose: no other profile gets anywhere near this
    // mean (the next lowest is `sobrecarga`, around 3,0), so adding a second
    // one would only make the detector fragile without making it sharper.
    looksFor: 'energia média no check-in ≤ 2,6',
    fires: (summary) => (summary.energyScoreMean ?? 5) <= 2.6,
  },
];

/** Which detectors a patient trips. */
export function detectorsFiringFor(summary: PatientSummary): readonly Detector[] {
  return DETECTORS.filter((detector) => detector.fires(summary));
}
