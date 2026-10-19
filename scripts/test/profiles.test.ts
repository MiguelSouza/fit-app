import assert from 'node:assert/strict';
import test from 'node:test';

import { generateDataset } from '../src/synthetic/dataset.ts';
import { PROFILES, profileFor, profileById } from '../src/synthetic/profiles.ts';
import { DETECTORS, detectorsFiringFor, summarize } from '../src/synthetic/summary.ts';

/**
 * The acceptance criterion "cada perfil problemático é identificável a olho
 * nos dados".
 *
 * "By eye" is made testable by the detectors in `summary.ts`: each one is a
 * sentence about the table `pnpm seed:synthetic` prints — training up and
 * sleep down, weight down while the meals are still being logged, adherence
 * collapsing, no check-in for three weeks, energy on the floor. The test
 * asserts both directions, because only one of them is interesting on its own:
 *
 * - every patient of a problematic profile trips its own detector, on several
 *   seeds, so the signal is the profile and not a lucky cohort;
 * - no patient of `estavel` trips any detector, because a signal that also
 *   fires on the patients who are fine is not a signal.
 */

/** Several cohorts: a profile has to be visible in whoever it is drawn onto. */
const COHORTS = [
  generateDataset({ patients: 24, seed: 4_242, days: 90, endDate: '2026-10-19' }),
  generateDataset({ patients: 24, seed: 1, days: 90, endDate: '2026-10-19' }),
  generateDataset({ patients: 24, seed: 999_983, days: 90, endDate: '2026-10-19' }),
  generateDataset({ patients: 24, seed: 20_260_115, days: 90, endDate: '2026-10-19' }),
];

/** Every patient of every cohort, with their summary alongside. */
const SUMMARIES = COHORTS.flatMap((cohort) =>
  cohort.patients.map((patient) => ({
    patient,
    summary: summarize(patient, cohort.manifest.endDate, cohort.manifest.days),
  })),
);

test('the six profiles are dealt out, one each, before any repeats', () => {
  assert.deepEqual(
    PROFILES.map((profile) => profile.id),
    [
      'estavel',
      'sobrecarga',
      'perda-de-peso-nao-planejada',
      'adesao-em-queda',
      'sumiu',
      'energia-baixa',
    ],
  );

  // The first patients get one profile each, so a run of six already shows
  // every profile.
  assert.deepEqual(
    Array.from({ length: PROFILES.length }, (_unused, index) => profileFor(index).id),
    PROFILES.map((profile) => profile.id),
  );

  // And a cohort of twenty is mostly patients who are fine, which is what a
  // queue worth triaging looks like.
  const [cohort] = COHORTS;

  assert.ok(cohort !== undefined);

  const steady = cohort.patients.filter((patient) => patient.profile === 'estavel');

  assert.ok(
    steady.length >= cohort.patients.length / 3,
    `only ${steady.length} of ${cohort.patients.length} patients are stable`,
  );

  // Every profile is present more than once in a cohort of 24, so a reader
  // can tell a trend from an individual.
  for (const profile of PROFILES) {
    const count = cohort.patients.filter((patient) => patient.profile === profile.id).length;

    assert.ok(count >= 2, `${profile.id} appears ${count} time(s) in a cohort of 24`);
  }
});

test('there is a detector for every problematic profile, and only for those', () => {
  assert.deepEqual(
    DETECTORS.map((detector) => detector.profile).sort(),
    PROFILES.filter((profile) => profile.id !== 'estavel')
      .map((profile) => profile.id)
      .sort(),
  );
});

for (const detector of DETECTORS) {
  test(`${detector.profile} is visible in the data (${detector.looksFor})`, () => {
    const matching = SUMMARIES.filter(({ patient }) => patient.profile === detector.profile);

    assert.ok(matching.length > 0, `no patient was generated on ${detector.profile}`);

    for (const { patient, summary } of matching) {
      assert.ok(
        detector.fires(summary),
        `${patient.code} is on ${detector.profile} and its detector does not fire: ` +
          JSON.stringify(summary),
      );
    }
  });
}

test('a stable patient trips no detector at all', () => {
  const steady = SUMMARIES.filter(({ patient }) => patient.profile === 'estavel');

  assert.ok(steady.length > 0, 'no stable patient was generated');

  for (const { patient, summary } of steady) {
    const firing = detectorsFiringFor(summary);

    assert.deepEqual(
      firing.map((detector) => detector.profile),
      [],
      `${patient.code} is stable and trips ${firing.map((d) => d.profile).join(', ')}: ` +
        JSON.stringify(summary),
    );
  }
});

test('sumiu stops answering while the wearable keeps reporting', () => {
  const vanished = SUMMARIES.filter(({ patient }) => patient.profile === 'sumiu');

  assert.ok(vanished.length > 0);

  for (const { patient } of vanished) {
    const { sleep, dailyMetrics, checkIns, weights, adherence } = patient.series;
    const lastDay = sleep.at(-1)?.nightOf;

    // The device syncs on its own, so it reports to the last day of the window.
    assert.equal(sleep.length, 90, `${patient.code} is missing nights`);
    assert.equal(dailyMetrics.length, 90, `${patient.code} is missing daily metrics`);
    assert.equal(dailyMetrics.at(-1)?.localDate, lastDay, `${patient.code} stopped syncing`);

    // Everything the person does stops, and stops at the same point: a patient
    // who kept weighing themselves while never answering would be a different
    // story than the one this profile tells.
    const lastCheckIn = checkIns.at(-1)?.localDate;
    const lastWeighIn = weights.at(-1)?.localDate;
    const lastLog = adherence.at(-1)?.localDate;

    assert.ok(lastCheckIn !== undefined && lastCheckIn < (lastDay ?? ''));
    assert.ok(lastWeighIn !== undefined && lastWeighIn < (lastDay ?? ''));
    assert.ok(lastLog !== undefined && lastLog < (lastDay ?? ''));

    // Roughly a third of the way in, which is what the profile says.
    assert.equal(adherence.length, 30, `${patient.code} logged ${adherence.length} days`);
  }
});

test('the trend of every profile stays inside the bounds it is written in', () => {
  for (const profile of PROFILES) {
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const trend = profile.at(progress);
      const where = `${profile.id} at ${progress}`;

      assert.ok(trend.trainingLoadFactor > 0, `${where}: training load factor is not positive`);
      assert.ok(trend.stepsFactor > 0, `${where}: steps factor is not positive`);
      assert.ok(trend.hrvFactor > 0, `${where}: hrv factor is not positive`);
      assert.ok(
        trend.mealAdherencePct >= 0 && trend.mealAdherencePct <= 100,
        `${where}: meal adherence target is ${trend.mealAdherencePct}`,
      );
      assert.ok(
        trend.energyScore >= 1 && trend.energyScore <= 5,
        `${where}: energy target is ${trend.energyScore}`,
      );
      assert.ok(
        trend.appetiteScore >= 1 && trend.appetiteScore <= 5,
        `${where}: appetite target is ${trend.appetiteScore}`,
      );
      assert.ok(
        trend.energyIntakeFactor > 0 && trend.energyIntakeFactor < 2,
        `${where}: energy intake factor is ${trend.energyIntakeFactor}`,
      );
    }
  }
});

test('profileById refuses a profile that does not exist', () => {
  assert.equal(profileById('sobrecarga').label, 'Sobrecarga');

  assert.throws(
    // The whole point is a value outside the union, which is what a stale
    // string from a manifest or a database would be.
    () => profileById('sobrecaarga' as Parameters<typeof profileById>[0]),
    /unknown profile/,
  );
});
