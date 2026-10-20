import type { ProfileId } from './profiles.ts';
import type { LocalDate } from './time.ts';

/**
 * The shape of what the generator produces.
 *
 * These are **not** the tables of the API. The four module schemas do not
 * exist yet — card F-07 stopped at wiring Drizzle Kit, and `drizzle/` holds no
 * migration — so there is nothing to insert into and nothing to import a type
 * from. What this file describes is the dataset: field names and units chosen
 * to match the vocabulary CLAUDE.md fixes for the `health` and `nutrition`
 * modules, so that the day the tables land the writer is a mapping and not a
 * redesign. See the README of this package for the seam.
 *
 * Every instant is a UTC ISO string and every `localDate` is the patient's own
 * calendar date, because both are needed to read a day of a body
 * (CLAUDE.md, "Dados de saúde"). Units are in the field names.
 */

/** Marks every person and organization the generator writes. */
export interface Synthetic {
  /**
   * Always true, and written into the data on purpose: a row that reaches a
   * database by accident should be recognisable there, not only in the file it
   * came from.
   */
  readonly synthetic: true;
}

export interface SyntheticOrganization extends Synthetic {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface SyntheticProfessional extends Synthetic {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly email: string;

  /**
   * Only a nutritionist may prescribe a meal plan, and CLAUDE.md asks the code
   * to check this and not the generic role — so the generator writes it, and
   * the one professional it creates is a nutritionist.
   */
  readonly professionalType: 'nutritionist';
}

/** Why a patient's data may be used, and since when. */
export interface SyntheticConsent {
  /**
   * `share_with_professional` is what lets the professional open the chart at
   * all; `ai_processing` is what lets the data reach a model (CLAUDE.md, "Saúde
   * e LGPD"). Without both the dataset would be unreachable by the two things
   * it was generated for.
   */
  readonly kind: 'share_with_professional' | 'ai_processing';
  readonly grantedAt: string;
  readonly revokedAt: null;
}

/** The link between a patient and the professional who follows them. */
export interface SyntheticLink {
  readonly professionalId: string;
  readonly organizationId: string;
  readonly startedAt: string;
  readonly endedAt: null;
}

export type Sex = 'female' | 'male';

export type ActivityType = 'strength' | 'running' | 'cycling' | 'swimming' | 'walking';

export type MealName = 'breakfast' | 'lunch' | 'snack' | 'dinner';

/** Where a record came from. Wearable data is never user-entered. */
export type RecordSource = 'wearable' | 'patient';

export interface SleepNight {
  /**
   * The local date the night **began** on, which is how a night is identified
   * (CLAUDE.md, "Dados de saúde"). The patient fell asleep on this date and
   * woke up on the next one.
   */
  readonly nightOf: LocalDate;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly timeInBedMin: number;
  readonly durationMin: number;
  readonly efficiencyPct: number;
  readonly deepMin: number;
  readonly lightMin: number;
  readonly remMin: number;
  readonly awakeMin: number;
  readonly avgHeartRateBpm: number;
  readonly hrvMs: number;
  readonly source: 'wearable';
}

export interface SyntheticActivity {
  readonly localDate: LocalDate;
  readonly startedAt: string;
  readonly type: ActivityType;
  readonly durationMin: number;

  /** Null for what has no distance, which here is strength training. */
  readonly distanceM: number | null;
  readonly avgHeartRateBpm: number;
  readonly maxHeartRateBpm: number;
  readonly activeEnergyKcal: number;

  /** Borg CR10, as the patient reported it. */
  readonly perceivedEffort: number;
  readonly source: 'wearable';
}

export interface DailyMetrics {
  readonly localDate: LocalDate;
  readonly stepCount: number;
  readonly restingHeartRateBpm: number;
  readonly hrvMs: number;
  readonly respiratoryRateBrpm: number;
  readonly activeEnergyKcal: number;
  readonly source: 'wearable';
}

export interface SyntheticCheckIn {
  readonly localDate: LocalDate;
  readonly answeredAt: string;
  readonly energyScore: number;
  readonly moodScore: number;
  readonly sleepQualityScore: number;
  readonly sorenessScore: number;
  readonly stressScore: number;
  readonly appetiteScore: number;
  readonly source: 'patient';
}

export interface WeightMeasurement {
  readonly localDate: LocalDate;
  readonly measuredAt: string;
  readonly weightKg: number;
  readonly source: 'patient';
}

/** One meal of the plan, and what was logged against it. */
export interface MealAdherence {
  readonly meal: MealName;
  readonly plannedProteinG: number;
  readonly plannedCarbsG: number;
  readonly plannedFatG: number;
  readonly plannedKcal: number;

  /** Null when the meal was not logged at all. */
  readonly loggedProteinG: number | null;
  readonly loggedCarbsG: number | null;
  readonly loggedFatG: number | null;
  readonly loggedKcal: number | null;
}

export interface DailyAdherence {
  readonly localDate: LocalDate;
  readonly meals: readonly MealAdherence[];

  /** Sums of the meals above. Computed, never typed (CLAUDE.md, "Dados de saúde"). */
  readonly plannedKcal: number;
  readonly loggedKcal: number;
  readonly mealsPlanned: number;
  readonly mealsLogged: number;

  /** How much of the plan was logged at all: logged meals over planned meals. */
  readonly mealAdherencePct: number;

  /**
   * How close the logged energy came to the energy prescribed **for the meals
   * that were logged**, capped at 100.
   *
   * Measured against the logged meals and not against the whole day on
   * purpose: the two numbers then say different things instead of both saying
   * "did not log". A patient who logs everything and eats well under the plan
   * shows up here and nowhere else, and that is what an unplanned weight loss
   * looks like from the nutrition side.
   */
  readonly energyAdherencePct: number;
}

/** The 90 days of one patient. */
export interface PatientSeries {
  readonly sleep: readonly SleepNight[];
  readonly activities: readonly SyntheticActivity[];
  readonly dailyMetrics: readonly DailyMetrics[];
  readonly checkIns: readonly SyntheticCheckIn[];
  readonly weights: readonly WeightMeasurement[];
  readonly adherence: readonly DailyAdherence[];
}

export interface SyntheticPatient extends Synthetic {
  readonly id: string;

  /** `PAC-007`: what the printed summary and a conversation refer to. */
  readonly code: string;
  readonly name: string;
  readonly email: string;
  readonly profile: ProfileId;
  readonly sex: Sex;
  readonly birthDate: LocalDate;
  readonly heightCm: number;

  /** The patient's own time zone, which every `localDate` above is read in. */
  readonly timezone: string;
  readonly link: SyntheticLink;
  readonly consents: readonly SyntheticConsent[];
  readonly series: PatientSeries;
}
