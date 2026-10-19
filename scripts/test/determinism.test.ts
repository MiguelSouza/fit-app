import assert from 'node:assert/strict';
import test from 'node:test';

import {
  generateDataset,
  MAX_DAYS,
  MAX_PATIENTS,
  MIN_DAYS,
  type DatasetOptions,
} from '../src/synthetic/dataset.ts';

/**
 * The acceptance criterion "semente aleatória fixa para resultados
 * reproduzíveis".
 *
 * Byte-identical, and not merely "similar": the generator reads no clock, no
 * environment variable and no file, so the options are the whole of its input.
 * That is what makes an alert worth discussing — two people running the same
 * command are looking at the same patient — and what lets the plausibility and
 * profile tests above assert exact numbers at all.
 */

const OPTIONS: DatasetOptions = {
  patients: 12,
  seed: 4_242,
  days: 90,
  endDate: '2026-10-19',
};

/** The dataset as the command writes it. */
const serialise = (options: DatasetOptions): string => JSON.stringify(generateDataset(options));

test('the same options produce byte-identical output', () => {
  assert.equal(serialise(OPTIONS), serialise(OPTIONS));
});

test('each option changes the output when it changes', () => {
  const base = serialise(OPTIONS);

  assert.notEqual(base, serialise({ ...OPTIONS, seed: OPTIONS.seed + 1 }));
  assert.notEqual(base, serialise({ ...OPTIONS, patients: OPTIONS.patients + 1 }));
  assert.notEqual(base, serialise({ ...OPTIONS, days: OPTIONS.days + 1 }));
  assert.notEqual(base, serialise({ ...OPTIONS, endDate: '2026-10-20' }));
  assert.notEqual(base, serialise({ ...OPTIONS, timezone: 'Europe/Lisbon' }));
});

test('a larger run contains the people of a smaller one, unchanged', () => {
  const small = generateDataset({ ...OPTIONS, patients: 5 });
  const large = generateDataset({ ...OPTIONS, patients: 40 });

  // The clinic first: adding patients must not move the organization or the
  // professional, or every id in a previous run would be stale.
  assert.deepEqual(small.organization, large.organization);
  assert.deepEqual(small.professional, large.professional);

  for (const [index, patient] of small.patients.entries()) {
    assert.deepEqual(
      patient,
      large.patients[index],
      `patient ${index} differs between a run of 5 and a run of 40`,
    );
  }
});

test('the manifest says what it takes to repeat the run', () => {
  const { manifest } = generateDataset(OPTIONS);

  assert.equal(manifest.seed, OPTIONS.seed);
  assert.equal(manifest.days, OPTIONS.days);
  assert.equal(manifest.endDate, OPTIONS.endDate);
  assert.equal(manifest.startDate, '2026-07-22');
  assert.equal(manifest.patientCount, OPTIONS.patients);
  assert.equal(manifest.timezone, 'America/Sao_Paulo');

  // And which profile each patient got, so a cohort can be read without
  // opening a single patient file.
  assert.deepEqual(
    manifest.profiles.map(({ code }) => code),
    generateDataset(OPTIONS).patients.map(({ code }) => code),
  );

  assert.equal(
    serialise(OPTIONS),
    serialise({
      patients: manifest.patientCount,
      seed: manifest.seed,
      days: manifest.days,
      endDate: manifest.endDate,
      timezone: manifest.timezone,
    }),
    'the manifest does not reproduce the run it describes',
  );
});

test('the window is the days asked for, ending on the date asked for', () => {
  for (const days of [MIN_DAYS, 30, 90, 365]) {
    const cohort = generateDataset({ ...OPTIONS, patients: 1, days });
    const [patient] = cohort.patients;

    assert.ok(patient !== undefined);
    assert.equal(patient.series.sleep.length, days);
    assert.equal(patient.series.dailyMetrics.length, days);
    assert.equal(patient.series.sleep.at(0)?.nightOf, cohort.manifest.startDate);
    assert.equal(patient.series.sleep.at(-1)?.nightOf, cohort.manifest.endDate);
  }
});

test('options the generator cannot honour are refused, not rounded', () => {
  const cases: readonly (readonly [Partial<DatasetOptions>, RegExp])[] = [
    [{ patients: 0 }, /patients/],
    [{ patients: MAX_PATIENTS + 1 }, /patients/],
    [{ patients: 2.5 }, /patients/],
    [{ days: MIN_DAYS - 1 }, /days/],
    [{ days: MAX_DAYS + 1 }, /days/],
    [{ seed: 1.5 }, /seed/],
    [{ endDate: '19/10/2026' }, /end-date/],
    [{ endDate: '2026-02-30' }, /end-date/],
  ];

  for (const [override, message] of cases) {
    assert.throws(
      () => generateDataset({ ...OPTIONS, ...override }),
      message,
      `${JSON.stringify(override)} was accepted`,
    );
  }
});
