import assert from 'node:assert/strict';
import test from 'node:test';

import { generateDataset, MAX_PATIENTS } from '../src/synthetic/dataset.ts';
import {
  EMAIL_DOMAIN,
  FAMILY_NAMES,
  GIVEN_NAMES,
  nameAt,
  PROFESSIONAL_NAME,
} from '../src/synthetic/names.ts';

/**
 * The acceptance criterion "nenhum nome ou dado parecido com pessoa real".
 *
 * The guarantee is structural, not statistical: the names can only come from
 * the two hand-written pools of invented words, the addresses can only be on
 * an unregistrable `.invalid` domain, and no field anywhere carries a document
 * number or a phone number. So this asserts the structure, and then sweeps the
 * serialised cohort for the shapes that would contradict it — an eleven-digit
 * run that could be read as a CPF, a Brazilian mobile number, a reachable
 * address.
 */

const COHORT = generateDataset({ patients: 60, seed: 4_242, days: 90, endDate: '2026-10-19' });

test('every name comes from the invented pools', () => {
  for (const patient of COHORT.patients) {
    const [given, family, ...extra] = patient.name.split(' ');

    assert.deepEqual(extra, [], `${patient.code} has a name of more than two parts`);
    assert.ok(
      GIVEN_NAMES.includes(given as (typeof GIVEN_NAMES)[number]),
      `${patient.code} has the given name "${given}", which is not in the pool`,
    );
    assert.ok(
      FAMILY_NAMES.includes(family as (typeof FAMILY_NAMES)[number]),
      `${patient.code} has the family name "${family}", which is not in the pool`,
    );
  }
});

test('no two people in a cohort share a name', () => {
  const names = [...COHORT.patients.map((patient) => patient.name), COHORT.professional.name];

  assert.equal(new Set(names).size, names.length, 'two people share a name');
});

test('the names stay distinct all the way to the patient cap', () => {
  const names = new Set(Array.from({ length: MAX_PATIENTS }, (_unused, index) => nameAt(index)));

  assert.equal(names.size, MAX_PATIENTS);

  // And the professional is not one of them, whatever the run size.
  assert.ok(!names.has(PROFESSIONAL_NAME));
});

test('a patient keeps their name and their profile as the run grows', () => {
  const small = generateDataset({ patients: 5, seed: 4_242, days: 90, endDate: '2026-10-19' });

  for (const [index, patient] of small.patients.entries()) {
    const larger = COHORT.patients[index];

    assert.ok(larger !== undefined);
    assert.equal(patient.code, larger.code);
    assert.equal(patient.name, larger.name);
    assert.equal(patient.profile, larger.profile);
  }
});

test('every address is on a domain that can never exist', () => {
  const addresses = [...COHORT.patients.map((patient) => patient.email), COHORT.professional.email];

  for (const address of addresses) {
    assert.ok(
      address.endsWith(`@${EMAIL_DOMAIN}`),
      `${address} is not on the ${EMAIL_DOMAIN} domain`,
    );

    // `.invalid` is reserved by RFC 2606 and cannot be registered, so no run
    // of this script can produce an address that reaches anybody.
    assert.ok(address.endsWith('.invalid'), `${address} is not under .invalid`);
  }

  assert.equal(new Set(addresses).size, addresses.length, 'two people share an address');
});

test('the local part of an address is a serial number, not a name', () => {
  for (const patient of COHORT.patients) {
    assert.equal(patient.email, `${patient.code.toLowerCase()}@${EMAIL_DOMAIN}`);
  }
});

test('the organization says in its own name that it is not real', () => {
  assert.match(COHORT.organization.name, /sintétic/i);
  assert.equal(COHORT.organization.synthetic, true);
  assert.equal(COHORT.professional.synthetic, true);

  for (const patient of COHORT.patients) {
    assert.equal(patient.synthetic, true, `${patient.code} is not marked synthetic`);
  }
});

test('nothing in the cohort looks like a document or a phone number', () => {
  const serialised = JSON.stringify(COHORT);

  /**
   * The shapes that would make a field mistakable for a real identifier. Dates
   * and instants are stripped first: an ISO timestamp is a long run of digits
   * and separators, and it is not what any of these are looking for.
   */
  const withoutDates = serialised.replaceAll(/\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/g, '<date>');

  const forbidden: readonly { readonly pattern: RegExp; readonly what: string }[] = [
    { pattern: /\d{11,}/, what: 'an eleven digit run, which could be read as a CPF' },
    { pattern: /\d{3}\.\d{3}\.\d{3}-\d{2}/, what: 'a formatted CPF' },
    { pattern: /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/, what: 'a formatted CNPJ' },
    { pattern: /\+?55\s?\(?\d{2}\)?\s?9?\d{4}-?\d{4}/, what: 'a Brazilian phone number' },
    { pattern: /\bCPF\b|\bCRN\b|\bCRM\b/i, what: 'a reference to a professional register' },
  ];

  for (const { pattern, what } of forbidden) {
    const found = pattern.exec(withoutDates);

    assert.equal(found, null, `the cohort contains ${what}: ${found?.[0] ?? ''}`);
  }
});

test('no address of a real domain appears anywhere in the cohort', () => {
  // Any `@` in the serialised cohort has to be one of ours. A field added later
  // that carried a plausible address would fail here rather than in a demo.
  for (const match of JSON.stringify(COHORT).matchAll(/[\w.+-]+@[\w.-]+/g)) {
    assert.ok(
      match[0].endsWith(`@${EMAIL_DOMAIN}`),
      `the cohort contains the address ${match[0]}, which is not under ${EMAIL_DOMAIN}`,
    );
  }
});
