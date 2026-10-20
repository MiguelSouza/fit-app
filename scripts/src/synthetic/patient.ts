import { emailFor, nameAt } from './names.ts';
import type { Profile } from './profiles.ts';
import { clamp, round, type Random } from './random.ts';
import { PLAUSIBLE } from './ranges.ts';
import type {
  ActivityType,
  DailyAdherence,
  DailyMetrics,
  MealAdherence,
  MealName,
  Sex,
  SleepNight,
  SyntheticActivity,
  SyntheticCheckIn,
  SyntheticPatient,
  WeightMeasurement,
} from './records.ts';
import { dateMinusDays, instantAt, instantPlusMinutes, type LocalDate } from './time.ts';

/**
 * One patient and their 90 days.
 *
 * The day is built in the order a body lives it, and each step feeds the next:
 * what was trained decides the acute load, the acute load bends the resting
 * heart rate and the variability, those decide the night, the night decides
 * how the check-in reads. A generator that drew each series on its own would
 * produce numbers in the right ranges that contradict each other — a patient
 * sleeping nine hours while reporting exhaustion, a resting heart rate that
 * ignores a doubled training week — and the point of this data is to be read
 * the way a professional reads a chart, across the series.
 *
 * The profile (`profiles.ts`) supplies the trend; everything else here is the
 * individual: the baseline is drawn per patient, so two people on the same
 * profile never produce the same numbers.
 */

/** What each kind of session looks like. */
interface ActivityShape {
  /** Average heart rate as a share of the patient's 220 − age capacity. */
  readonly intensity: number;

  /** Metabolic equivalent, for the energy estimate. */
  readonly met: number;

  /** Plausible pace, in km/h. Null for what covers no distance. */
  readonly speedKmh: readonly [number, number] | null;

  /** Longest session of this kind that still reads as one session. */
  readonly maxDurationMin: number;

  /** Where the perceived effort sits before the load factor moves it. */
  readonly baseEffort: number;
}

const ACTIVITY_SHAPES = {
  strength: { intensity: 0.66, met: 5, speedKmh: null, maxDurationMin: 110, baseEffort: 6 },
  running: {
    intensity: 0.83,
    met: 10,
    speedKmh: [8.5, 13.5],
    maxDurationMin: 120,
    baseEffort: 6.5,
  },
  cycling: { intensity: 0.78, met: 8.5, speedKmh: [21, 31], maxDurationMin: 120, baseEffort: 6 },
  swimming: { intensity: 0.76, met: 8, speedKmh: [2, 3.2], maxDurationMin: 90, baseEffort: 6.2 },
  walking: { intensity: 0.58, met: 3.8, speedKmh: [4.3, 5.8], maxDurationMin: 90, baseEffort: 3.2 },
} as const satisfies Record<ActivityType, ActivityShape>;

/**
 * The sports a patient does. Strength training is in every mix: these are
 * patients of a sports nutritionist, and the mix is what makes two of them
 * look different without the profile having to say anything about it.
 */
const SPORT_MIXES: readonly (readonly ActivityType[])[] = [
  ['strength', 'strength', 'running'],
  ['strength', 'cycling', 'cycling'],
  ['strength', 'strength', 'swimming'],
  ['running', 'running', 'strength', 'walking'],
  ['cycling', 'strength', 'strength', 'walking'],
  ['swimming', 'strength', 'running'],
];

/** The meals of the plan, and the share of the day's energy each one carries. */
const MEAL_SHARES: readonly (readonly [MealName, number])[] = [
  ['breakfast', 0.22],
  ['lunch', 0.33],
  ['snack', 0.15],
  ['dinner', 0.3],
];

/** Energy per gram, for turning macros into kilocalories. */
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/** How fast the acute training load forgets a session (EMA weight of today). */
const LOAD_ALPHA = 0.3;

/** How much of yesterday's scale noise carries into today. */
const WEIGHT_WALK_PERSISTENCE = 0.82;

/** Everything about a patient that does not change over the 90 days. */
interface Baseline {
  readonly sex: Sex;
  readonly ageYears: number;
  readonly birthDate: LocalDate;
  readonly heightCm: number;
  readonly startWeightKg: number;

  /** 220 − age: what the heart rates of a session are a share of. */
  readonly capacityBpm: number;
  readonly restingHeartRateBpm: number;
  readonly hrvMs: number;
  readonly sleepDurationMin: number;
  readonly sleepEfficiencyPct: number;
  readonly sessionsPerWeek: number;
  readonly sessionMinutes: number;
  readonly sportMix: readonly ActivityType[];
  readonly stepBaseline: number;

  /** How often this patient answers the check-in, on a day they still log. */
  readonly checkInChance: number;

  /** Which days of the 7-day cycle they step on the scale. */
  readonly weighInDays: readonly number[];

  /** Which days of the 7-day cycle they prefer to train, in order. */
  readonly trainingDayOrder: readonly number[];

  /**
   * The two times of day this patient keeps: when they train and when they go
   * to bed, both as minutes after a floor hour (06:00 and 22:00). People are
   * creatures of habit, and drawing these fresh every day produced a cohort
   * where everybody trained at dawn and went to bed at 23:55 — the clamped
   * edge of the distribution, which is what a draw with no personal centre
   * piles up against.
   */
  readonly trainingStartMinute: number;
  readonly bedtimeMinute: number;
  readonly plan: readonly MealPlan[];
}

/** One meal of the prescribed plan. */
interface MealPlan {
  readonly meal: MealName;
  readonly proteinG: number;
  readonly carbsG: number;
  readonly fatG: number;
  readonly kcal: number;
}

/** Kilocalories of a macro split. Computed, which is the only way it is ever set. */
function kcalOf(proteinG: number, carbsG: number, fatG: number): number {
  return Math.round(
    proteinG * KCAL_PER_G.protein + carbsG * KCAL_PER_G.carbs + fatG * KCAL_PER_G.fat,
  );
}

/**
 * The plan the nutritionist prescribed: energy from Mifflin-St Jeor and the
 * patient's training volume, protein from body mass, fat as a share of the
 * energy, carbohydrate as what is left. Not a clinical prescription — a
 * plausible one, which is what the data needs.
 */
function prescribePlan(random: Random, baseline: Omit<Baseline, 'plan'>): MealPlan[] {
  const restingKcal =
    10 * baseline.startWeightKg +
    6.25 * baseline.heightCm -
    5 * baseline.ageYears +
    (baseline.sex === 'male' ? 5 : -161);

  const targetKcal = clamp(
    restingKcal * (1.35 + 0.05 * baseline.sessionsPerWeek) * random.float(0.95, 1.05),
    PLAUSIBLE.plannedKcal.min,
    PLAUSIBLE.plannedKcal.max,
  );

  const dailyProteinG = round(random.float(1.7, 2.1) * baseline.startWeightKg);
  const dailyFatG = round((targetKcal * random.float(0.24, 0.3)) / KCAL_PER_G.fat);
  const dailyCarbsG = round(
    (targetKcal - dailyProteinG * KCAL_PER_G.protein - dailyFatG * KCAL_PER_G.fat) /
      KCAL_PER_G.carbs,
  );

  return MEAL_SHARES.map(([meal, share]) => {
    const proteinG = round(dailyProteinG * share);
    const carbsG = round(dailyCarbsG * share);
    const fatG = round(dailyFatG * share);

    return { meal, proteinG, carbsG, fatG, kcal: kcalOf(proteinG, carbsG, fatG) };
  });
}

/** Draws the individual, before any profile is applied to them. */
function drawBaseline(random: Random, endDate: LocalDate): Baseline {
  const sex: Sex = random.chance(0.55) ? 'female' : 'male';
  const ageYears = random.int(20, 58);

  // A birth date that agrees with the age: the age is what the physiology is
  // drawn from, so the date follows it instead of the other way round.
  const birthDate = dateMinusDays(endDate, ageYears * 365 + random.int(1, 364));

  const heightCm =
    sex === 'female' ? round(random.float(152, 174), 1) : round(random.float(164, 192), 1);

  const startWeightKg = round(random.float(19.5, 28) * (heightCm / 100) ** 2, 1);
  const sessionsPerWeek = random.int(3, 5);

  const partial = {
    sex,
    ageYears,
    birthDate,
    heightCm,
    startWeightKg,
    capacityBpm: 220 - ageYears,

    // Fitter people rest lower; the training volume is the only proxy for
    // fitness this generator has.
    restingHeartRateBpm: Math.round(random.clamped(70 - sessionsPerWeek * 2.2, 4, 42, 78)),

    // Variability falls with age, and spreads widely between people.
    hrvMs: Math.round(random.clamped(78 - (ageYears - 20) * 0.55, 9, 28, 115)),

    sleepDurationMin: random.int(390, 495),
    sleepEfficiencyPct: round(random.float(88, 95), 1),
    sessionsPerWeek,
    sessionMinutes: random.int(50, 80),
    sportMix: random.pick(SPORT_MIXES),
    stepBaseline: random.int(5200, 10_500),
    checkInChance: random.float(0.62, 0.85),
    weighInDays: random.shuffled([0, 1, 2, 3, 4, 5, 6]).slice(0, random.int(2, 3)),
    trainingDayOrder: random.shuffled([0, 1, 2, 3, 4, 5, 6]),
    // Between 06:00 and 17:30 for the session, 22:00 and 23:55 for bed.
    trainingStartMinute: random.int(0, 690),
    bedtimeMinute: random.int(0, 115),
  } satisfies Omit<Baseline, 'plan'>;

  return { ...partial, plan: prescribePlan(random, partial) };
}

/** What a week of training looks like, decided once per 7-day block. */
interface WeekPlan {
  /** Which days of the block have a session. */
  readonly trainingDays: readonly number[];

  /** How long each of them is, before the per-session noise. */
  readonly sessionMinutes: number;
}

/**
 * Turns a load factor into a week: more sessions first, longer sessions after.
 *
 * The weekly volume is the quantity the profile moves, and it is split so that
 * neither half runs away — six sessions is the most a week gets, and a single
 * session stays under two hours. A week built the other way (volume straight
 * into session length) produces four-hour training days that no range would
 * accept.
 */
function planWeek(baseline: Baseline, loadFactor: number): WeekPlan {
  const weeklyMinutes = baseline.sessionsPerWeek * baseline.sessionMinutes * loadFactor;
  const sessions = Math.round(clamp(baseline.sessionsPerWeek + (loadFactor - 1) * 2.5, 2, 6));

  return {
    trainingDays: [...baseline.trainingDayOrder].slice(0, sessions).sort((a, b) => a - b),
    sessionMinutes: clamp(weeklyMinutes / sessions, 25, 120),
  };
}

/** Draws one session. */
function drawActivity(
  random: Random,
  baseline: Baseline,
  localDate: LocalDate,
  timezone: string,
  weekPlan: WeekPlan,
  loadFactor: number,
): SyntheticActivity {
  const type = random.pick(baseline.sportMix);
  const shape = ACTIVITY_SHAPES[type];

  const durationMin = Math.round(
    random.clamped(
      weekPlan.sessionMinutes,
      weekPlan.sessionMinutes * 0.15,
      PLAUSIBLE.activityDurationMin.min,
      Math.min(shape.maxDurationMin, PLAUSIBLE.activityDurationMin.max),
    ),
  );

  const avgHeartRateBpm = Math.round(
    random.clamped(
      baseline.capacityBpm * shape.intensity,
      4,
      PLAUSIBLE.activityAvgHeartRateBpm.min,
      // Never at the ceiling: an average equal to the capacity leaves no room
      // for the peak of the session.
      Math.min(baseline.capacityBpm - 5, PLAUSIBLE.activityAvgHeartRateBpm.max),
    ),
  );

  const maxHeartRateBpm = clamp(
    avgHeartRateBpm + random.int(10, 26),
    Math.max(avgHeartRateBpm + 5, PLAUSIBLE.activityMaxHeartRateBpm.min),
    Math.min(baseline.capacityBpm, PLAUSIBLE.activityMaxHeartRateBpm.max),
  );

  const distanceM =
    shape.speedKmh === null
      ? null
      : Math.round(
          clamp(
            random.float(shape.speedKmh[0], shape.speedKmh[1]) * (durationMin / 60) * 1000,
            PLAUSIBLE.activityDistanceM.min,
            PLAUSIBLE.activityDistanceM.max,
          ),
        );

  // The textbook MET estimate: MET × 3.5 × kg / 200 is kcal per minute.
  const activeEnergyKcal = Math.round(
    clamp(
      ((shape.met * 3.5 * baseline.startWeightKg) / 200) * durationMin * random.float(0.92, 1.08),
      PLAUSIBLE.activityActiveEnergyKcal.min,
      PLAUSIBLE.activityActiveEnergyKcal.max,
    ),
  );

  const startMinute = Math.round(random.clamped(baseline.trainingStartMinute, 35, 0, 690));

  return {
    localDate,
    // Sessions happen between 06:00 and 17:30, drawn towards the morning.
    startedAt: instantAt(localDate, 6 + Math.floor(startMinute / 60), startMinute % 60, timezone),
    type,
    durationMin,
    distanceM,
    avgHeartRateBpm,
    maxHeartRateBpm,
    activeEnergyKcal,
    perceivedEffort: Math.round(
      random.clamped(
        shape.baseEffort + (loadFactor - 1) * 2,
        0.8,
        PLAUSIBLE.perceivedEffort.min,
        PLAUSIBLE.perceivedEffort.max,
      ),
    ),
    source: 'wearable',
  };
}

/** Draws the night that began on `localDate`. */
function drawSleep(
  random: Random,
  baseline: Baseline,
  localDate: LocalDate,
  timezone: string,
  sleepMinutesDelta: number,
  sleepEfficiencyDelta: number,
  loadPressure: number,
  restingHeartRateBpm: number,
  hrvMs: number,
): SleepNight {
  const durationMin = Math.round(
    random.clamped(
      baseline.sleepDurationMin + sleepMinutesDelta - loadPressure * 6,
      32,
      PLAUSIBLE.sleepDurationMin.min,
      PLAUSIBLE.sleepDurationMin.max,
    ),
  );

  const targetEfficiency = random.clamped(
    baseline.sleepEfficiencyPct + sleepEfficiencyDelta,
    2.6,
    PLAUSIBLE.sleepEfficiencyPct.min,
    99,
  );

  // Time in bed follows from the duration and the target, and the efficiency
  // that gets stored is then recomputed from the two: a device reports three
  // numbers that agree, and rounding each of them separately is how they stop
  // agreeing.
  const timeInBedMin = Math.round(
    clamp(
      (durationMin * 100) / targetEfficiency,
      Math.max(durationMin + 2, PLAUSIBLE.timeInBedMin.min),
      PLAUSIBLE.timeInBedMin.max,
    ),
  );

  const deepMin = Math.round(durationMin * random.float(0.13, 0.22));
  const remMin = Math.round(durationMin * random.float(0.16, 0.25));

  // Bedtime stays before midnight, between 22:00 and 23:55. It is not that
  // nobody goes to bed at half past one: it is that `nightOf` is the date the
  // night began, so a bedtime past midnight belongs to the next date, and two
  // nights would then claim the same one.
  const bedMinute = Math.round(random.clamped(baseline.bedtimeMinute, 22, 0, 115));
  const startedAt = instantAt(localDate, 22 + Math.floor(bedMinute / 60), bedMinute % 60, timezone);

  return {
    nightOf: localDate,
    startedAt,
    endedAt: instantPlusMinutes(startedAt, timeInBedMin),
    timeInBedMin,
    durationMin,
    efficiencyPct: round((durationMin / timeInBedMin) * 100, 1),
    deepMin,
    lightMin: durationMin - deepMin - remMin,
    remMin,
    awakeMin: timeInBedMin - durationMin,
    // Sleeping heart rate sits at or just under the resting rate, which is
    // itself measured over this night.
    avgHeartRateBpm: Math.round(
      random.clamped(
        restingHeartRateBpm + 1,
        2,
        PLAUSIBLE.sleepHeartRateBpm.min,
        PLAUSIBLE.sleepHeartRateBpm.max,
      ),
    ),
    hrvMs,
    source: 'wearable',
  };
}

/** Everything the generator needs to produce one patient. */
export interface PatientRequest {
  /** Zero-based position in the run: what the code, the name and the profile follow. */
  readonly index: number;
  readonly profile: Profile;

  /** This patient's own stream, so their data does not depend on the run size. */
  readonly random: Random;
  readonly days: number;

  /** Last day of the window, inclusive. */
  readonly endDate: LocalDate;
  readonly timezone: string;
  readonly organizationId: string;
  readonly professionalId: string;

  /** When the link and the consents started, UTC. */
  readonly enrolledAt: string;
}

export function generatePatient(request: PatientRequest): SyntheticPatient {
  const { random, profile, days, endDate, timezone } = request;
  const baseline = drawBaseline(random, endDate);

  const sleep: SleepNight[] = [];
  const activities: SyntheticActivity[] = [];
  const dailyMetrics: DailyMetrics[] = [];
  const checkIns: SyntheticCheckIn[] = [];
  const weights: WeightMeasurement[] = [];
  const adherence: DailyAdherence[] = [];

  /** Exponential moving average of the daily training minutes. */
  let acuteLoadMin = (baseline.sessionsPerWeek * baseline.sessionMinutes) / 7;

  /** The slow, correlated part of the scale noise. */
  let weightWalkKg = 0;

  let weekPlan = planWeek(baseline, 1);

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const localDate = dateMinusDays(endDate, days - 1 - dayIndex);
    const progress = days === 1 ? 1 : dayIndex / (days - 1);
    const trend = profile.at(progress);
    const dayOfCycle = dayIndex % 7;

    if (dayOfCycle === 0) weekPlan = planWeek(baseline, trend.trainingLoadFactor);

    // --- what was trained today
    const todaysActivities = weekPlan.trainingDays.includes(dayOfCycle)
      ? [drawActivity(random, baseline, localDate, timezone, weekPlan, trend.trainingLoadFactor)]
      : [];

    activities.push(...todaysActivities);

    const trainedMinutes = todaysActivities.reduce((total, one) => total + one.durationMin, 0);

    acuteLoadMin = acuteLoadMin * (1 - LOAD_ALPHA) + trainedMinutes * LOAD_ALPHA;

    /**
     * How far above (or below) their own habitual volume this patient is right
     * now, as a share of it. This is what carries a rising training load into
     * the resting heart rate, the variability and the night — the three places
     * a coach would notice it before the patient says anything.
     */
    const habitualDailyMin = (baseline.sessionsPerWeek * baseline.sessionMinutes) / 7;
    const loadPressure = clamp((acuteLoadMin - habitualDailyMin) / habitualDailyMin, -1, 2);

    // --- the night, and the two numbers measured over it
    const restingHeartRateBpm = Math.round(
      random.clamped(
        baseline.restingHeartRateBpm + trend.restingHrDelta + loadPressure * 1.5,
        1.8,
        PLAUSIBLE.restingHeartRateBpm.min,
        PLAUSIBLE.restingHeartRateBpm.max,
      ),
    );

    const hrvMs = Math.round(
      random.clamped(
        baseline.hrvMs * trend.hrvFactor * (1 - loadPressure * 0.04),
        5,
        PLAUSIBLE.hrvMs.min,
        PLAUSIBLE.hrvMs.max,
      ),
    );

    const night = drawSleep(
      random,
      baseline,
      localDate,
      timezone,
      trend.sleepMinutesDelta,
      trend.sleepEfficiencyDelta,
      loadPressure,
      restingHeartRateBpm,
      hrvMs,
    );

    sleep.push(night);

    // --- the rest of the day the device reports
    const walkedSteps = todaysActivities.reduce(
      (total, one) =>
        total +
        (one.type === 'running' || one.type === 'walking' ? (one.distanceM ?? 0) / 0.85 : 600),
      0,
    );

    const stepCount = Math.round(
      random.clamped(
        baseline.stepBaseline * trend.stepsFactor + walkedSteps,
        1300,
        PLAUSIBLE.stepCount.min,
        PLAUSIBLE.stepCount.max,
      ),
    );

    dailyMetrics.push({
      localDate,
      stepCount,
      restingHeartRateBpm,
      hrvMs,
      respiratoryRateBrpm: round(
        random.clamped(
          14.5 + trend.restingHrDelta * 0.08,
          0.9,
          PLAUSIBLE.respiratoryRateBrpm.min,
          PLAUSIBLE.respiratoryRateBrpm.max,
        ),
        1,
      ),
      activeEnergyKcal: Math.round(
        clamp(
          todaysActivities.reduce((total, one) => total + one.activeEnergyKcal, 0) +
            stepCount * 0.035,
          PLAUSIBLE.dailyActiveEnergyKcal.min,
          PLAUSIBLE.dailyActiveEnergyKcal.max,
        ),
      ),
      source: 'wearable',
    });

    // --- the scale: a slow trend plus noise that remembers yesterday
    weightWalkKg = weightWalkKg * WEIGHT_WALK_PERSISTENCE + random.normal(0, 0.22);

    const trueWeightKg = baseline.startWeightKg * (1 + trend.weightChangePct / 100) + weightWalkKg;

    // --- what the patient does, which is the part that can stop
    if (trend.logs) {
      if (baseline.weighInDays.includes(dayOfCycle)) {
        const measuredMinute = random.int(0, 119);

        weights.push({
          localDate,
          // On the scale first thing, between 06:00 and 07:59.
          measuredAt: instantAt(
            localDate,
            6 + Math.floor(measuredMinute / 60),
            measuredMinute % 60,
            timezone,
          ),
          weightKg: round(
            clamp(
              trueWeightKg + random.normal(0, 0.12),
              PLAUSIBLE.weightKg.min,
              PLAUSIBLE.weightKg.max,
            ),
            1,
          ),
          source: 'patient',
        });
      }

      if (random.chance(baseline.checkInChance)) {
        const answerMinute = Math.round(random.clamped(60, 45, 0, 165));

        checkIns.push({
          localDate,
          // The check-in is answered in the morning, about the night just past.
          answeredAt: instantAt(
            localDate,
            7 + Math.floor(answerMinute / 60),
            answerMinute % 60,
            timezone,
          ),
          energyScore: score(random, trend.energyScore, 0.55),
          moodScore: score(random, trend.energyScore + 0.15, 0.6),
          // Read off the night the patient just woke from, which is the one
          // that *began* the day before: a check-in answered at 08:00 on the
          // 12th cannot be reporting the night of the 12th, which has not
          // happened yet. On the first day of the window there is no previous
          // night on record, so that one answers for itself. 60% efficiency
          // reads as a 1, 95% as a 5.
          sleepQualityScore: score(
            random,
            1 + (((sleep.at(-2) ?? night).efficiencyPct - 60) / 35) * 4,
            0.4,
          ),
          sorenessScore: score(random, 2 + loadPressure * 1.1, 0.6),
          // Stress tracks the variability being below this patient's own normal.
          stressScore: score(random, 3 - (hrvMs / baseline.hrvMs - 1) * 2.2, 0.6),
          appetiteScore: score(random, trend.appetiteScore, 0.5),
          source: 'patient',
        });
      }

      adherence.push(
        logMeals(random, baseline, localDate, trend.mealAdherencePct, trend.energyIntakeFactor),
      );
    }
  }

  const code = `PAC-${String(request.index + 1).padStart(3, '0')}`;

  return {
    id: random.uuid(),
    code,
    name: nameAt(request.index),
    email: emailFor(code),
    profile: profile.id,
    sex: baseline.sex,
    birthDate: baseline.birthDate,
    heightCm: baseline.heightCm,
    timezone,
    synthetic: true,
    link: {
      professionalId: request.professionalId,
      organizationId: request.organizationId,
      startedAt: request.enrolledAt,
      endedAt: null,
    },
    consents: [
      { kind: 'share_with_professional', grantedAt: request.enrolledAt, revokedAt: null },
      { kind: 'ai_processing', grantedAt: request.enrolledAt, revokedAt: null },
    ],
    series: { sleep, activities, dailyMetrics, checkIns, weights, adherence },
  };
}

/** A check-in answer: a 1 to 5 integer, drawn around where the trend puts it. */
function score(random: Random, around: number, spread: number): number {
  return Math.round(
    random.clamped(around, spread, PLAUSIBLE.checkInScore.min, PLAUSIBLE.checkInScore.max),
  );
}

/**
 * The day's adherence: which prescribed meals were logged, and how close what
 * was logged came to what was prescribed.
 *
 * Two numbers, because adherence fails in two different ways and a single
 * percentage hides which one happened: a patient who stops logging
 * (`mealAdherencePct`) and a patient who logs everything while eating well
 * under the plan (`energyAdherencePct`) are two different conversations, and
 * the second one is what an unplanned weight loss looks like from here.
 */
function logMeals(
  random: Random,
  baseline: Baseline,
  localDate: LocalDate,
  mealAdherencePct: number,
  energyIntakeFactor: number,
): DailyAdherence {
  const meals: MealAdherence[] = baseline.plan.map((planned) => {
    if (!random.chance(mealAdherencePct / 100)) {
      return {
        meal: planned.meal,
        plannedProteinG: planned.proteinG,
        plannedCarbsG: planned.carbsG,
        plannedFatG: planned.fatG,
        plannedKcal: planned.kcal,
        loggedProteinG: null,
        loggedCarbsG: null,
        loggedFatG: null,
        loggedKcal: null,
      };
    }

    // Each macro drifts on its own: hitting the protein and missing the
    // carbohydrate is the common shape, and one shared factor would never
    // produce it.
    const of = (grams: number): number =>
      Math.max(0, round(grams * energyIntakeFactor * random.clamped(1, 0.12, 0.55, 1.5)));

    const loggedProteinG = of(planned.proteinG);
    const loggedCarbsG = of(planned.carbsG);
    const loggedFatG = of(planned.fatG);

    return {
      meal: planned.meal,
      plannedProteinG: planned.proteinG,
      plannedCarbsG: planned.carbsG,
      plannedFatG: planned.fatG,
      plannedKcal: planned.kcal,
      loggedProteinG,
      loggedCarbsG,
      loggedFatG,
      loggedKcal: kcalOf(loggedProteinG, loggedCarbsG, loggedFatG),
    };
  });

  const logged = meals.filter((meal) => meal.loggedKcal !== null);
  const plannedKcal = meals.reduce((total, meal) => total + meal.plannedKcal, 0);
  const loggedKcal = logged.reduce((total, meal) => total + (meal.loggedKcal ?? 0), 0);
  const plannedKcalOfLogged = logged.reduce((total, meal) => total + meal.plannedKcal, 0);

  return {
    localDate,
    meals,
    plannedKcal,
    loggedKcal,
    mealsPlanned: meals.length,
    mealsLogged: logged.length,
    mealAdherencePct: Math.round((logged.length / meals.length) * 100),
    energyAdherencePct:
      plannedKcalOfLogged === 0
        ? 0
        : Math.min(
            PLAUSIBLE.adherencePct.max,
            Math.round((loggedKcal / plannedKcalOfLogged) * 100),
          ),
  };
}
