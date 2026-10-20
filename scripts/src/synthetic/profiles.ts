import { lerp } from './random.ts';

/**
 * The ready-made patient profiles the card asks for.
 *
 * A profile is not a label stapled onto random data: it is the trajectory the
 * 90 days follow. Each one answers, for a given point in the window, where the
 * patient's sleep, training load, weight, adherence and mood should be
 * relative to their own baseline — and `patient.ts` draws the day around that
 * answer.
 *
 * The acceptance criterion is that a problematic profile is identifiable at a
 * glance ("cada perfil problemático é identificável a olho nos dados"), so
 * every trend below moves far enough to survive the day to day noise drawn on
 * top of it. `summary.ts` computes the handful of numbers that make it visible,
 * `pnpm seed:synthetic` prints them, and `test/profiles.test.ts` asserts that
 * each profile trips its own detector and that `estavel` trips none.
 */

export type ProfileId =
  | 'estavel'
  | 'sobrecarga'
  | 'perda-de-peso-nao-planejada'
  | 'adesao-em-queda'
  | 'sumiu'
  | 'energia-baixa';

/**
 * Where a profile is at one point of the window. Deltas and factors apply to
 * the patient's own baseline, never to an absolute: two patients on the same
 * profile diverge in their numbers and agree in their shape, which is how real
 * cohorts look.
 */
export interface ProfileTrend {
  /** Added to the baseline sleep duration, in minutes. */
  readonly sleepMinutesDelta: number;

  /** Added to the baseline sleep efficiency, in percentage points. */
  readonly sleepEfficiencyDelta: number;

  /** Multiplies the weekly training volume and nudges the perceived effort. */
  readonly trainingLoadFactor: number;

  /** Multiplies the daily step baseline. */
  readonly stepsFactor: number;

  /** Change in body weight since day one, in percent of the starting weight. */
  readonly weightChangePct: number;

  /** Share of the planned meals the patient still logs. */
  readonly mealAdherencePct: number;

  /** Logged energy over planned energy, on the meals that were logged. */
  readonly energyIntakeFactor: number;

  /** Where the check-in's energy and mood scores sit, on the 1 to 5 scale. */
  readonly energyScore: number;

  /** Where the check-in's appetite score sits, same scale. */
  readonly appetiteScore: number;

  /** Added to the baseline resting heart rate, in bpm. */
  readonly restingHrDelta: number;

  /** Multiplies the baseline heart rate variability. */
  readonly hrvFactor: number;

  /**
   * Whether the patient is still using the app. False means no check-in and no
   * meal log for that day — and the wearable keeps reporting, because it syncs
   * on its own. That gap between a body that is still being measured and a
   * person who stopped answering is the whole signature of `sumiu`.
   */
  readonly logs: boolean;
}

/**
 * A patient who is doing fine: the baseline itself, with a slight planned
 * weight loss. Every other profile is written as a deviation from this.
 */
function steadyTrend(progress: number): ProfileTrend {
  return {
    sleepMinutesDelta: 0,
    sleepEfficiencyDelta: 0,
    trainingLoadFactor: 1,
    stepsFactor: 1,
    weightChangePct: lerp(0, -0.8, progress),
    mealAdherencePct: lerp(90, 87, progress),
    energyIntakeFactor: 0.97,
    energyScore: 4,
    appetiteScore: 3.6,
    restingHrDelta: 0,
    hrvFactor: 1,
    logs: true,
  };
}

export interface Profile {
  readonly id: ProfileId;

  /** Short name, for the panel and for the summary this script prints. */
  readonly label: string;

  /** What to look for in the data. Shown by `pnpm seed:synthetic --help`. */
  readonly signature: string;

  /**
   * The trend at `progress`, which runs from 0 on the first day of the window
   * to 1 on the last.
   */
  at(progress: number): ProfileTrend;
}

/**
 * The day of `sumiu` on which the patient stops answering, as a share of the
 * window: a third of the way in, so there is a month of normal data to compare
 * against and two months of silence to notice.
 */
const VANISHED_AT = 1 / 3;

export const PROFILES: readonly Profile[] = [
  {
    id: 'estavel',
    label: 'Estável',
    signature: 'nada se move: sono, treino, peso e adesão ficam na faixa de sempre',
    at: steadyTrend,
  },

  {
    id: 'sobrecarga',
    label: 'Sobrecarga',
    signature: 'treino sobe ~90%, sono cai ~1h40, repouso sobe e a VFC desaba',
    at: (progress) => ({
      ...steadyTrend(progress),
      trainingLoadFactor: lerp(1, 1.9, progress),
      sleepMinutesDelta: lerp(0, -100, progress),
      sleepEfficiencyDelta: lerp(0, -5, progress),
      restingHrDelta: lerp(0, 9, progress),
      hrvFactor: lerp(1, 0.65, progress),
      energyScore: lerp(4, 2, progress),
      appetiteScore: lerp(3.6, 3, progress),
      mealAdherencePct: lerp(90, 74, progress),
      weightChangePct: lerp(0, -1.8, progress),
      stepsFactor: lerp(1, 1.15, progress),
    }),
  },

  {
    id: 'perda-de-peso-nao-planejada',
    label: 'Perda de peso não planejada',
    // The point of this one is what it does *not* explain: the meals are being
    // logged and the training is unchanged, so neither answers for the scale.
    // What gives it away is the energy actually logged and the appetite.
    signature: 'peso cai ~7,5% com treino e adesão normais; energia ingerida e apetite caem',
    at: (progress) => ({
      ...steadyTrend(progress),
      weightChangePct: lerp(0, -7.5, progress),
      energyIntakeFactor: lerp(0.95, 0.74, progress),
      appetiteScore: lerp(3.2, 1.9, progress),
      energyScore: lerp(3.8, 2.4, progress),
      restingHrDelta: lerp(0, 4, progress),
      hrvFactor: lerp(1, 0.85, progress),
      mealAdherencePct: 86,
      trainingLoadFactor: lerp(1, 0.95, progress),
      stepsFactor: lerp(1, 0.92, progress),
    }),
  },

  {
    id: 'adesao-em-queda',
    label: 'Adesão em queda',
    signature: 'adesão às refeições cai de ~96% para ~32%, peso sobe devagar',
    at: (progress) => ({
      ...steadyTrend(progress),
      mealAdherencePct: lerp(96, 32, progress),
      // The meals that still get logged drift past the plan, which is the
      // other half of adherence going.
      energyIntakeFactor: lerp(0.98, 1.08, progress),
      weightChangePct: lerp(0, 2.2, progress),
      energyScore: lerp(4, 3.2, progress),
      trainingLoadFactor: lerp(1, 0.8, progress),
    }),
  },

  {
    id: 'sumiu',
    label: 'Sumiu',
    signature: 'check-in e registro de refeição param no dia 31; o wearable continua',
    at: (progress) => ({
      ...steadyTrend(progress),
      weightChangePct: lerp(0, 0.8, progress),
      logs: progress <= VANISHED_AT,
    }),
  },

  {
    id: 'energia-baixa',
    label: 'Energia baixa',
    signature: 'energia no check-in ≤ 2, VFC baixa e passos em queda, com sono de duração normal',
    at: (progress) => ({
      ...steadyTrend(progress),
      energyScore: lerp(2.6, 1.6, progress),
      appetiteScore: lerp(3, 2.8, progress),
      // Enough hours in bed and a bad night anyway: the duration stays normal
      // and the efficiency is what gives it away.
      sleepMinutesDelta: lerp(10, 20, progress),
      sleepEfficiencyDelta: lerp(-8, -12, progress),
      hrvFactor: lerp(0.8, 0.72, progress),
      restingHrDelta: lerp(3, 5, progress),
      trainingLoadFactor: lerp(0.8, 0.55, progress),
      stepsFactor: lerp(0.78, 0.65, progress),
      mealAdherencePct: lerp(82, 78, progress),
    }),
  },
];

/** Looks a profile up by id. */
export function profileById(id: ProfileId): Profile {
  const profile = PROFILES.find((candidate) => candidate.id === id);

  if (profile === undefined) throw new Error(`unknown profile: ${id}`);

  return profile;
}

/**
 * How the profiles are dealt out after every one of them has been used once:
 * `estavel` every other seat, the five problematic ones spread through the
 * rest. A cohort where half the patients need attention would be a cohort
 * nobody has to triage, and triage is what this data is for.
 */
const DECK: readonly ProfileId[] = [
  'estavel',
  'sobrecarga',
  'estavel',
  'adesao-em-queda',
  'estavel',
  'perda-de-peso-nao-planejada',
  'estavel',
  'energia-baixa',
  'estavel',
  'sumiu',
  'estavel',
  'estavel',
];

/**
 * The profile of the patient at `index`.
 *
 * The first patients get one profile each, in the order of `PROFILES`, so a
 * run of six already shows every profile and a run of one shows `estavel`.
 * After that the deck above repeats. The assignment is positional, never
 * drawn: patient 3 keeps its profile when the run grows, same as its name and
 * its data.
 *
 * @param index zero-based position of the patient in the run
 */
export function profileFor(index: number): Profile {
  const first = PROFILES[index];

  if (first !== undefined) return first;

  const dealt = DECK[(index - PROFILES.length) % DECK.length];

  // Unreachable: `DECK` is a non-empty literal and the modulus is its length.
  if (dealt === undefined) throw new Error(`no profile for index ${index}: the deck is empty`);

  return profileById(dealt);
}
