import assert from 'node:assert/strict';
import test from 'node:test';

import { clamp, createRandom, hashSeed, lerp, round } from '../src/synthetic/random.ts';

/**
 * The random source. Everything else in the generator inherits its
 * reproducibility from here, so this is the one place where "same seed, same
 * numbers" is asserted on the numbers themselves.
 */

/** The first `count` draws of a fresh stream on `seed`. */
function draws(seed: number, count = 50): number[] {
  const random = createRandom(seed);

  return Array.from({ length: count }, () => random.next());
}

test('the same seed produces the same stream, a different one does not', () => {
  assert.deepEqual(draws(7), draws(7));
  assert.notDeepEqual(draws(7), draws(8));

  // Neighbouring seeds too: mulberry32 advances its state by a constant, so
  // seeds one apart would otherwise overlap after a single draw.
  assert.notDeepEqual(draws(7), draws(6));
});

test('next() stays in [0, 1)', () => {
  const random = createRandom(123);

  for (let draw = 0; draw < 20_000; draw += 1) {
    const value = random.next();

    assert.ok(value >= 0 && value < 1, `next() returned ${value}`);
  }
});

test('int() covers both ends and never leaves them', () => {
  const random = createRandom(9);
  const seen = new Set<number>();

  for (let draw = 0; draw < 5_000; draw += 1) {
    const value = random.int(3, 7);

    assert.ok(Number.isInteger(value), `int() returned ${value}`);
    assert.ok(value >= 3 && value <= 7, `int() returned ${value}`);
    seen.add(value);
  }

  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    [3, 4, 5, 6, 7],
  );
});

test('int() refuses bounds it cannot honour', () => {
  const random = createRandom(1);

  assert.throws(() => random.int(5, 1), /min <= max/);
  assert.throws(() => random.int(0.5, 3), /integer bounds/);
});

test('clamped() keeps the tail inside the range', () => {
  const random = createRandom(55);

  for (let draw = 0; draw < 20_000; draw += 1) {
    // A standard deviation far wider than the range: without the clamp this
    // would leave it on most draws.
    const value = random.clamped(50, 400, 40, 60);

    assert.ok(value >= 40 && value <= 60, `clamped() returned ${value}`);
  }
});

test('normal() lands around its mean', () => {
  const random = createRandom(2024);
  const draws = Array.from({ length: 40_000 }, () => random.normal(100, 15));
  const average = draws.reduce((total, value) => total + value, 0) / draws.length;

  // Loose on purpose: this asserts the transform is not broken, not that the
  // distribution passes a statistical test.
  assert.ok(Math.abs(average - 100) < 1, `mean was ${average}`);
  assert.ok(
    draws.some((value) => value > 115),
    'no draw above one sigma',
  );
  assert.ok(
    draws.some((value) => value < 85),
    'no draw below one sigma',
  );
});

test('pick() only returns members, and refuses an empty list', () => {
  const random = createRandom(31);
  const items = ['a', 'b', 'c'] as const;

  for (let draw = 0; draw < 500; draw += 1) {
    assert.ok(items.includes(random.pick(items)));
  }

  assert.throws(() => random.pick([]), /non-empty/);
});

test('shuffled() keeps every item and leaves the input alone', () => {
  const random = createRandom(77);
  const items = [0, 1, 2, 3, 4, 5, 6];
  const shuffled = random.shuffled(items);

  assert.deepEqual(items, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(
    [...shuffled].sort((a, b) => a - b),
    items,
  );
});

test('uuid() is a valid v4 and does not repeat', () => {
  const random = createRandom(5);
  const seen = new Set<string>();

  for (let draw = 0; draw < 5_000; draw += 1) {
    const uuid = random.uuid();

    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    seen.add(uuid);
  }

  assert.equal(seen.size, 5_000);
});

test('derived streams are independent of each other', () => {
  const master = createRandom(100);

  const of = (label: string): number[] =>
    Array.from({ length: 10 }, () => master.stream(label).next());

  // Same label, same numbers — which is the property a patient's data hangs
  // off — and different labels do not collide.
  assert.deepEqual(of('patient:3'), of('patient:3'));
  assert.notDeepEqual(of('patient:3'), of('patient:4'));
  assert.notDeepEqual(of('patient:3'), of('organization'));
});

test('hashSeed() separates labels that differ in one character', () => {
  const seeds = new Set(
    Array.from({ length: 400 }, (_unused, index) => hashSeed(`patient:${index}`, 1)),
  );

  assert.equal(seeds.size, 400);
  assert.notEqual(hashSeed('a', 1), hashSeed('a', 2));
});

test('lerp, round and clamp do what the trends assume', () => {
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 1), 20);
  assert.equal(lerp(10, 20, 0.5), 15);

  // Progress outside [0, 1] is held at the ends: a trend is never extrapolated.
  assert.equal(lerp(10, 20, -3), 10);
  assert.equal(lerp(10, 20, 3), 20);

  assert.equal(round(1.2345, 2), 1.23);
  assert.equal(round(1.5), 2);
  assert.equal(clamp(5, 1, 3), 3);
  assert.equal(clamp(-5, 1, 3), 1);
  assert.equal(clamp(2, 1, 3), 2);
});
