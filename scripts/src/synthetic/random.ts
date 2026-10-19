/**
 * The random source of the synthetic patient generator.
 *
 * Seeded and self-contained: `Math.random` is never read here, so the same
 * seed always produces the same organization, the same people and the same 90
 * days of data. That is what the card asks for ("semente aleatória fixa para
 * resultados reproduzíveis"), and it is what makes an alert worth discussing —
 * two people looking at patient `PAC-004` are looking at the same numbers.
 *
 * The generator is `mulberry32`: a 32-bit state, four lines of arithmetic, and
 * a period long enough for the few hundred thousand draws a run makes. A
 * cryptographic generator would be the wrong tool — it cannot be seeded for
 * reproducibility, which is the whole requirement.
 */

/** 2^32, the divisor that turns the 32-bit state into a number in [0, 1). */
const UINT32 = 0x1_0000_0000;

/** Offsets of FNV-1a, 32-bit: what `hashSeed` mixes the label into. */
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x0100_0193;

/**
 * A seeded stream of numbers, plus the few shapes the generator draws from.
 *
 * Every method consumes from the same stream, so the order of the calls is
 * part of the output: inserting a draw shifts everything after it. That is why
 * each patient gets a stream of its own (`stream`) instead of sharing one.
 */
export interface Random {
  /** The next number in [0, 1). */
  next(): number;

  /** An integer in [min, max], both ends included. */
  int(min: number, max: number): number;

  /** A number in [min, max). */
  float(min: number, max: number): number;

  /**
   * A draw from a normal distribution. Most of what a body does is normally
   * distributed around a personal baseline — a night of sleep, a resting heart
   * rate, the weight on the scale — so this, and not `float`, is what the day
   * to day noise comes from. Uniform noise reads as static.
   */
  normal(mean: number, standardDeviation: number): number;

  /**
   * `normal`, kept inside a range. The clamp is what keeps the data plausible
   * when a trend pushes a baseline towards the edge of what a body does: the
   * tail of a normal distribution is unbounded, and a 2 h night or a 210 bpm
   * resting heart rate would fail `ranges.ts`.
   */
  clamped(mean: number, standardDeviation: number, min: number, max: number): number;

  /** One item of a non-empty list. */
  pick<T>(items: readonly T[]): T;

  /** True with probability `probability`. */
  chance(probability: number): boolean;

  /** A copy of `items` in a random order. */
  shuffled<T>(items: readonly T[]): T[];

  /** A v4-shaped uuid, drawn from this stream — so ids are reproducible too. */
  uuid(): string;

  /**
   * An independent stream, derived from this one's seed and a label.
   *
   * This is what keeps a patient's data from depending on how many patients
   * were asked for: patient 3 of a run of 5 and patient 3 of a run of 20 draw
   * from `stream('patient:3')` of the same master seed, and come out
   * identical. `--patients 20` is a superset of `--patients 5`, which makes a
   * small run a fast way to look at the same people.
   */
  stream(label: string): Random;
}

/**
 * Turns a label and a seed into a new 32-bit seed, with FNV-1a.
 *
 * Exported because the test asserts the property that matters: different
 * labels have to land on different streams, or two patients would live the
 * same 90 days.
 */
export function hashSeed(label: string, seed: number): number {
  let hash = (FNV_OFFSET ^ (seed >>> 0)) >>> 0;

  for (let index = 0; index < label.length; index += 1) {
    hash = (hash ^ label.charCodeAt(index)) >>> 0;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }

  // One last avalanche, so labels that differ in a single character do not
  // produce seeds that are close together: mulberry32's first draw follows its
  // state closely, and near-identical seeds would start near-identical.
  hash = (hash ^ (hash >>> 16)) >>> 0;
  hash = Math.imul(hash, 0x85eb_ca6b) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;

  return hash >>> 0;
}

/** The bare generator: a closure over the 32-bit state. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;

    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / UINT32;
  };
}

/** Creates a stream from a seed. */
export function createRandom(seed: number): Random {
  const next = mulberry32(seed);

  const random: Random = {
    next,

    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new Error(`int() takes integer bounds, got ${min}..${max}`);
      }

      if (max < min) throw new Error(`int() needs min <= max, got ${min}..${max}`);

      // `Math.min` covers the (impossible in practice, but free to rule out)
      // case of `next()` returning exactly 1 after a rounding step.
      return Math.min(max, min + Math.floor(next() * (max - min + 1)));
    },

    float(min, max) {
      if (max < min) throw new Error(`float() needs min <= max, got ${min}..${max}`);

      return min + next() * (max - min);
    },

    normal(mean, standardDeviation) {
      // Box-Muller. `1 - next()` instead of `next()` because the transform
      // takes a logarithm and `next()` can return exactly 0.
      const radius = Math.sqrt(-2 * Math.log(1 - next()));
      const angle = 2 * Math.PI * next();

      return mean + standardDeviation * radius * Math.cos(angle);
    },

    clamped(mean, standardDeviation, min, max) {
      if (max < min) throw new Error(`clamped() needs min <= max, got ${min}..${max}`);

      return Math.min(max, Math.max(min, random.normal(mean, standardDeviation)));
    },

    pick(items) {
      const item = items[random.int(0, items.length - 1)];

      if (item === undefined) throw new Error('pick() needs a non-empty list');

      return item;
    },

    chance(probability) {
      return next() < probability;
    },

    shuffled(items) {
      // Sorting by a drawn key, rather than Fisher-Yates: one draw per item,
      // no indexed writes, and the same result for the same seed. `sort` is
      // stable and the keys are distinct in practice, so the order is decided
      // by the draws and nothing else.
      return items
        .map((item) => ({ item, key: next() }))
        .sort((left, right) => left.key - right.key)
        .map(({ item }) => item);
    },

    uuid() {
      const bytes = Array.from({ length: 16 }, () => random.int(0, 255));

      // Version 4 and the RFC 4122 variant, so the string is not just
      // uuid-shaped but a valid v4 — whatever ends up storing these ids will
      // have a `uuid` column, and it should accept them without a second
      // thought.
      bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
      bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

      const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');

      return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
      ].join('-');
    },

    stream(label) {
      return createRandom(hashSeed(label, seed));
    },
  };

  return random;
}

/**
 * Linear interpolation, the shape every profile trend is written in: where a
 * value starts, where it ends, and how far along the 90 days we are.
 */
export function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, progress));
}

/** Rounds to `decimals` places, for the values a device reports rounded. */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;

  return Math.round(value * factor) / factor;
}

/** Keeps a value inside a range, for the few places that clamp a computed sum. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
