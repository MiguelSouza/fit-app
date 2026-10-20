import assert from 'node:assert/strict';
import test from 'node:test';

import { generateDataset } from '../src/synthetic/dataset.ts';
import { isWithin, PLAUSIBLE, type Range } from '../src/synthetic/ranges.ts';
import type { SyntheticPatient } from '../src/synthetic/records.ts';
import { daysBetween } from '../src/synthetic/time.ts';

/**
 * The acceptance criterion "dados plausíveis (frequência cardíaca, sono e peso
 * em faixas realistas)".
 *
 * Every record of a full cohort is walked and every number is held against
 * `ranges.ts`. The ranges are generous — they are the bounds of what a device
 * could report for an adult, not of what a healthy one does — so a failure
 * here is not a tuning question: it means a profile pushed a value somewhere a
 * body does not go.
 *
 * On top of the ranges, the checks that no single range can make: the numbers
 * of a record have to agree with each other. Sleep stages that sum to the
 * duration, time in bed that is never less than the time asleep, a peak heart
 * rate above the average of the same session, a day's totals that are the sum
 * of its meals. A generator that drew each field independently would pass
 * every range and still produce charts that contradict themselves.
 */

/**
 * The cohort the structural assertions read: 24 patients, so every profile
 * appears more than once, on the window the card asks for.
 */
const COHORT = generateDataset({ patients: 24, seed: 4_242, days: 90, endDate: '2026-10-19' });

/**
 * And four more cohorts for the range assertions, on other seeds and other
 * window widths. One seed proves that one cohort came out inside the ranges;
 * what the criterion asks is that the generator does, and a bound tuned until
 * a single run passed would be exactly the mistake worth catching.
 */
const COHORTS = [
  COHORT,
  generateDataset({ patients: 12, seed: 1, days: 90, endDate: '2027-01-01' }),
  generateDataset({ patients: 12, seed: 999_983, days: 90, endDate: '2026-02-28' }),
  generateDataset({ patients: 12, seed: 7, days: 21, endDate: '2026-10-19' }),
  generateDataset({ patients: 12, seed: 20_260_115, days: 180, endDate: '2026-10-19' }),
];

/** Every patient of every cohort above. */
const EVERY_PATIENT: readonly SyntheticPatient[] = COHORTS.flatMap((cohort) => [
  ...cohort.patients,
]);

/** Asserts that `value` is inside `range`, naming what failed. */
function within(value: number, range: Range, what: string): void {
  assert.ok(isWithin(value, range), `${what} was ${value}, outside ${range.min}..${range.max}`);
}

test('the cohort is the one the options asked for', () => {
  assert.equal(COHORT.patients.length, 24);
  assert.equal(COHORT.manifest.startDate, '2026-07-22');
  assert.equal(COHORT.manifest.endDate, '2026-10-19');
  assert.equal(COHORT.professional.professionalType, 'nutritionist');

  for (const patient of COHORT.patients) {
    // The two series a device writes never stop: 90 days means 90 nights and
    // 90 days of metrics, whatever the patient did or did not do.
    assert.equal(patient.series.sleep.length, 90, `${patient.code} nights`);
    assert.equal(patient.series.dailyMetrics.length, 90, `${patient.code} daily metrics`);
  }
});

test('the people are adults of a plausible size', () => {
  // Over the cohorts rather than over the patients: the age is read against
  // the end of the window each cohort was generated for.
  for (const cohort of COHORTS) {
    for (const patient of cohort.patients) {
      within(patient.heightCm, PLAUSIBLE.heightCm, `${patient.code} height`);

      const ageYears = daysBetween(patient.birthDate, cohort.manifest.endDate) / 365.25;

      within(ageYears, PLAUSIBLE.ageYears, `${patient.code} age`);
    }
  }
});

test('every night of sleep is plausible and internally consistent', () => {
  for (const patient of EVERY_PATIENT) {
    for (const night of patient.series.sleep) {
      const where = `${patient.code} ${night.nightOf}`;

      within(night.durationMin, PLAUSIBLE.sleepDurationMin, `${where} sleep duration`);
      within(night.timeInBedMin, PLAUSIBLE.timeInBedMin, `${where} time in bed`);
      within(night.efficiencyPct, PLAUSIBLE.sleepEfficiencyPct, `${where} sleep efficiency`);
      within(night.avgHeartRateBpm, PLAUSIBLE.sleepHeartRateBpm, `${where} sleep heart rate`);
      within(night.hrvMs, PLAUSIBLE.hrvMs, `${where} hrv`);

      assert.ok(
        night.timeInBedMin > night.durationMin,
        `${where}: ${night.timeInBedMin} min in bed for ${night.durationMin} min asleep`,
      );

      assert.equal(
        night.deepMin + night.lightMin + night.remMin,
        night.durationMin,
        `${where}: the stages do not add up to the duration`,
      );

      assert.equal(
        night.awakeMin,
        night.timeInBedMin - night.durationMin,
        `${where}: awake is not the difference between in bed and asleep`,
      );

      assert.ok(night.lightMin > 0, `${where}: no light sleep`);

      // The efficiency stored has to be the one the two durations imply, or
      // three numbers of the same record disagree.
      assert.ok(
        Math.abs(night.efficiencyPct - (night.durationMin / night.timeInBedMin) * 100) < 0.1,
        `${where}: efficiency ${night.efficiencyPct} does not follow from the durations`,
      );

      // The night is identified by the date it began on (CLAUDE.md, "Dados de
      // saúde"), and it ends on the next one.
      assert.ok(night.startedAt < night.endedAt, `${where}: the night ends before it starts`);
    }

    // One night per date, and no date twice: a bedtime that crossed midnight
    // would make two nights claim the same one.
    const nights = patient.series.sleep.map((night) => night.nightOf);

    assert.equal(new Set(nights).size, nights.length, `${patient.code} has a repeated nightOf`);
  }
});

test('every session is plausible, and its peak is above its average', () => {
  for (const patient of EVERY_PATIENT) {
    for (const activity of patient.series.activities) {
      const where = `${patient.code} ${activity.localDate} ${activity.type}`;

      within(activity.durationMin, PLAUSIBLE.activityDurationMin, `${where} duration`);
      within(activity.avgHeartRateBpm, PLAUSIBLE.activityAvgHeartRateBpm, `${where} avg hr`);
      within(activity.maxHeartRateBpm, PLAUSIBLE.activityMaxHeartRateBpm, `${where} max hr`);
      within(
        activity.activeEnergyKcal,
        PLAUSIBLE.activityActiveEnergyKcal,
        `${where} active energy`,
      );
      within(activity.perceivedEffort, PLAUSIBLE.perceivedEffort, `${where} perceived effort`);

      assert.ok(
        activity.maxHeartRateBpm > activity.avgHeartRateBpm,
        `${where}: peak ${activity.maxHeartRateBpm} is not above the average ${activity.avgHeartRateBpm}`,
      );

      // Strength training covers no distance; everything else does.
      if (activity.type === 'strength') {
        assert.equal(activity.distanceM, null, `${where}: strength training with a distance`);
      } else {
        assert.notEqual(activity.distanceM, null, `${where}: no distance`);
        within(activity.distanceM ?? 0, PLAUSIBLE.activityDistanceM, `${where} distance`);
      }
    }
  }
});

test('every day of metrics is plausible', () => {
  for (const patient of EVERY_PATIENT) {
    for (const day of patient.series.dailyMetrics) {
      const where = `${patient.code} ${day.localDate}`;

      within(day.stepCount, PLAUSIBLE.stepCount, `${where} steps`);
      within(day.restingHeartRateBpm, PLAUSIBLE.restingHeartRateBpm, `${where} resting heart rate`);
      within(day.hrvMs, PLAUSIBLE.hrvMs, `${where} hrv`);
      within(day.respiratoryRateBrpm, PLAUSIBLE.respiratoryRateBrpm, `${where} respiratory rate`);
      within(day.activeEnergyKcal, PLAUSIBLE.dailyActiveEnergyKcal, `${where} active energy`);
    }
  }
});

test('every check-in answer is on the scale it says it is', () => {
  for (const patient of EVERY_PATIENT) {
    for (const checkIn of patient.series.checkIns) {
      const where = `${patient.code} ${checkIn.localDate}`;
      const scores = {
        energy: checkIn.energyScore,
        mood: checkIn.moodScore,
        sleepQuality: checkIn.sleepQualityScore,
        soreness: checkIn.sorenessScore,
        stress: checkIn.stressScore,
        appetite: checkIn.appetiteScore,
      };

      for (const [name, score] of Object.entries(scores)) {
        within(score, PLAUSIBLE.checkInScore, `${where} ${name}`);
        assert.ok(Number.isInteger(score), `${where} ${name} was ${score}, not a whole answer`);
      }
    }
  }
});

test('the scale moves like a body, not like a broken device', () => {
  for (const patient of EVERY_PATIENT) {
    const weights = patient.series.weights;

    for (const measurement of weights) {
      within(measurement.weightKg, PLAUSIBLE.weightKg, `${patient.code} weight`);
    }

    for (let index = 1; index < weights.length; index += 1) {
      const previous = weights[index - 1];
      const current = weights[index];

      if (previous === undefined || current === undefined) continue;

      const elapsed = Math.max(1, daysBetween(previous.localDate, current.localDate));
      const perDay = Math.abs(current.weightKg - previous.weightKg) / elapsed;

      within(
        perDay,
        PLAUSIBLE.weightDeltaKgPerDay,
        `${patient.code} ${previous.localDate}→${current.localDate} daily weight change`,
      );
    }
  }
});

test('adherence totals are the sum of the meals, never a separate number', () => {
  for (const patient of EVERY_PATIENT) {
    for (const day of patient.series.adherence) {
      const where = `${patient.code} ${day.localDate}`;
      const logged = day.meals.filter((meal) => meal.loggedKcal !== null);

      assert.equal(day.mealsPlanned, day.meals.length, `${where} meals planned`);
      assert.equal(day.mealsLogged, logged.length, `${where} meals logged`);

      assert.equal(
        day.plannedKcal,
        day.meals.reduce((total, meal) => total + meal.plannedKcal, 0),
        `${where}: planned energy is not the sum of the meals`,
      );

      assert.equal(
        day.loggedKcal,
        logged.reduce((total, meal) => total + (meal.loggedKcal ?? 0), 0),
        `${where}: logged energy is not the sum of the meals`,
      );

      within(day.plannedKcal, PLAUSIBLE.plannedKcal, `${where} planned energy`);
      within(day.loggedKcal, PLAUSIBLE.loggedKcal, `${where} logged energy`);
      within(day.mealAdherencePct, PLAUSIBLE.adherencePct, `${where} meal adherence`);
      within(day.energyAdherencePct, PLAUSIBLE.adherencePct, `${where} energy adherence`);

      // Energy follows from the macros, both for what was prescribed and for
      // what was logged (CLAUDE.md: totals are computed, never typed).
      for (const meal of day.meals) {
        assert.equal(
          meal.plannedKcal,
          Math.round(meal.plannedProteinG * 4 + meal.plannedCarbsG * 4 + meal.plannedFatG * 9),
          `${where} ${meal.meal}: planned energy does not follow from the macros`,
        );

        const bothNull =
          meal.loggedKcal === null &&
          meal.loggedProteinG === null &&
          meal.loggedCarbsG === null &&
          meal.loggedFatG === null;

        if (bothNull) continue;

        assert.equal(
          meal.loggedKcal,
          Math.round(
            (meal.loggedProteinG ?? 0) * 4 +
              (meal.loggedCarbsG ?? 0) * 4 +
              (meal.loggedFatG ?? 0) * 9,
          ),
          `${where} ${meal.meal}: logged energy does not follow from the macros`,
        );
      }
    }
  }
});

test('every date and instant belongs to the window', () => {
  const { startDate, endDate } = COHORT.manifest;

  /** Every local date the patient's records carry. */
  const datesOf = (patient: SyntheticPatient): string[] => [
    ...patient.series.sleep.map((night) => night.nightOf),
    ...patient.series.activities.map((activity) => activity.localDate),
    ...patient.series.dailyMetrics.map((day) => day.localDate),
    ...patient.series.checkIns.map((checkIn) => checkIn.localDate),
    ...patient.series.weights.map((measurement) => measurement.localDate),
    ...patient.series.adherence.map((day) => day.localDate),
  ];

  for (const patient of COHORT.patients) {
    for (const date of datesOf(patient)) {
      assert.ok(
        date >= startDate && date <= endDate,
        `${patient.code} has a record on ${date}, outside ${startDate}..${endDate}`,
      );
    }

    // Every instant is UTC, which is how the API stores them.
    for (const night of patient.series.sleep) {
      assert.match(night.startedAt, /Z$/, `${patient.code} ${night.nightOf} startedAt is not UTC`);
      assert.match(night.endedAt, /Z$/, `${patient.code} ${night.nightOf} endedAt is not UTC`);
    }

    // The patients were enrolled before the window opened: a consent granted
    // after the data it covers would be the one thing this cohort must not
    // model.
    assert.ok(
      patient.link.startedAt < `${startDate}T00:00:00.000Z`,
      `${patient.code} was linked after the window opened`,
    );

    for (const consent of patient.consents) {
      assert.ok(
        consent.grantedAt < `${startDate}T00:00:00.000Z`,
        `${patient.code} granted ${consent.kind} after the window opened`,
      );
    }
  }
});
