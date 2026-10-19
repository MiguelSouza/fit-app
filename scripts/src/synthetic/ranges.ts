/**
 * What counts as a plausible value.
 *
 * One table, read twice: the generator clamps every draw to it, and
 * `test/plausibility.test.ts` walks every record of a generated run and
 * asserts it. That is the acceptance criterion "dados plausíveis (frequência
 * cardíaca, sono e peso em faixas realistas)" written down as a number instead
 * of as an opinion — if a profile is ever retuned past one of these bounds,
 * the test says so.
 *
 * The bounds are wide on purpose. They are not "what a healthy adult does",
 * they are "what a device could report for an adult without the row being
 * obvious nonsense": the generator aims at the middle of each one, and the
 * edges exist so that a clamp never has to lie about a trend.
 *
 * Everything is metric and in the unit named by the key, as the API stores it
 * (CLAUDE.md, "Dados de saúde").
 */

/** A closed interval, both ends included. */
export interface Range {
  readonly min: number;
  readonly max: number;
}

export const PLAUSIBLE = {
  /** Adults only: the app has no paediatric flow. */
  ageYears: { min: 18, max: 70 },

  heightCm: { min: 150, max: 200 },

  /** Paired with the heights above this spans roughly BMI 16 to 45. */
  weightKg: { min: 40, max: 160 },

  /**
   * How much the scale may move between two weigh-ins of the same patient, per
   * day elapsed. Real body weight moves slowly; what moves fast is water, and
   * ~1 kg a day is already the loose end of that; the bound is a little wider
   * so that two weigh-ins on consecutive days cannot trip it by noise alone. A
   * series that jumped past it would read as a broken scale, not as a trend.
   */
  weightDeltaKgPerDay: { min: 0, max: 1.5 },

  /** Resting heart rate, as a wearable reports it overnight. */
  restingHeartRateBpm: { min: 38, max: 85 },

  /** Heart rate variability, rMSSD. Falls with age, load and poor sleep. */
  hrvMs: { min: 15, max: 140 },

  respiratoryRateBrpm: { min: 9, max: 22 },

  stepCount: { min: 200, max: 32_000 },

  /** Active energy of the whole day, training included. */
  dailyActiveEnergyKcal: { min: 60, max: 3000 },

  /** Time actually asleep. 3 h is a terrible night; 11 h is a long one. */
  sleepDurationMin: { min: 180, max: 660 },

  /** Time in bed, which is always at least the time asleep. */
  timeInBedMin: { min: 182, max: 720 },

  sleepEfficiencyPct: { min: 50, max: 100 },

  /** Heart rate during sleep: at or just under the resting rate. */
  sleepHeartRateBpm: { min: 35, max: 90 },

  activityDurationMin: { min: 15, max: 180 },

  activityAvgHeartRateBpm: { min: 80, max: 185 },

  activityMaxHeartRateBpm: { min: 90, max: 205 },

  /** From a 30 min walk to a two-hour ride. Null, not zero, for the gym. */
  activityDistanceM: { min: 200, max: 70_000 },

  activityActiveEnergyKcal: { min: 40, max: 2200 },

  /** Borg CR10, the scale the check-in uses for perceived effort. */
  perceivedEffort: { min: 1, max: 10 },

  /** Every subjective score of the check-in, on the same 1 to 5 scale. */
  checkInScore: { min: 1, max: 5 },

  /** Adherence, as a percentage. Both of the two the generator computes. */
  adherencePct: { min: 0, max: 100 },

  /** The energy the plan prescribes for a day. */
  plannedKcal: { min: 1400, max: 4000 },

  /** What the patient logged. Zero on a day nothing was logged. */
  loggedKcal: { min: 0, max: 4800 },
} as const satisfies Record<string, Range>;

/** Whether `value` is inside `range`. */
export function isWithin(value: number, range: Range): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}
