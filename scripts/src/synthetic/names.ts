/**
 * The names and the contact details of the synthetic people.
 *
 * This file is the acceptance criterion "nenhum nome ou dado parecido com
 * pessoa real", and it answers it by construction rather than by filtering:
 *
 * - **The names are invented words.** Not drawn from a census list, not
 *   "common Brazilian first names", not an anonymised real roster. Every part
 *   below was made up to be pronounceable in pt-BR and to belong to nobody:
 *   `Varnesca Quilopeda` reads as a person and matches no one. A generator
 *   that assembled syllables at random would eventually land on a real name,
 *   so the pools are written out and reviewable instead.
 * - **The e-mail addresses cannot reach anybody.** The domain is under
 *   `.invalid`, the top level domain RFC 2606 reserves for exactly this: it
 *   can never be registered and never resolves. A typo in a seeding script can
 *   therefore not mail a stranger.
 * - **There are no documents and no phone numbers.** No CPF, no CRN, no
 *   number that could coincide with a real one. The card does not ask for
 *   them, and a generated identifier that happens to validate is a liability.
 *
 * Which is also why the names are strange rather than ordinary. Anyone who
 * sees this data in a demo, in a screenshot or in a database should be able to
 * tell at a glance that no patient is behind it.
 */

/**
 * Invented given names. None of these is a given name in any language we know
 * of; they only follow the sound of one.
 */
export const GIVEN_NAMES = [
  'Alquine',
  'Berinto',
  'Caldiva',
  'Dorvane',
  'Eslira',
  'Fontalbo',
  'Grusenda',
  'Hervino',
  'Ilbrante',
  'Jorvela',
  'Kenduro',
  'Lispera',
  'Morvaldi',
  'Nurebia',
  'Olvanto',
  'Pirandel',
  'Quesalba',
  'Rombido',
  'Sulvenia',
  'Torbana',
  'Urvelio',
  'Varnesca',
  'Xendira',
  'Zalbrino',
] as const;

/** Invented family names, on the same principle. */
export const FAMILY_NAMES = [
  'Quilopeda',
  'Trensalvo',
  'Mordibela',
  'Flenzari',
  'Grubenta',
  'Vastrilho',
  'Pelundra',
  'Chirvanto',
  'Brimalda',
  'Zunferra',
  'Dralquente',
  'Mospirela',
  'Xanterbo',
  'Lurvandi',
  'Crebalto',
  'Tauperino',
  'Sembrivo',
  'Yalderico',
  'Fanquirra',
  'Nhorizanda',
] as const;

/**
 * The e-mail domain. Under `.invalid` (RFC 2606), so it is unregistrable and
 * unroutable by definition.
 */
export const EMAIL_DOMAIN = 'exemplo.invalid';

/**
 * The name of the organization. Invented too, and it says what it is in the
 * one place every screen of the panel shows.
 */
export const ORGANIZATION_NAME = 'Clínica Nurevale (dados sintéticos)';

/** Its slug, for whatever ends up addressing an organization by name. */
export const ORGANIZATION_SLUG = 'clinica-nurevale-sintetica';

/**
 * The name of the one professional. Its own constant, and its parts are
 * deliberately outside the pools above, so the nutritionist can never end up
 * sharing a name with a patient.
 */
export const PROFESSIONAL_NAME = 'Welquidra Pestanhoca';

/**
 * Picks a name by index, so the pair is decided by the person's position in
 * the run and not by a draw. Two things follow: patient 3 keeps its name when
 * the run grows (same property the random streams give the data), and the
 * pools are walked in step instead of repeating a pair early.
 *
 * The family name advances once per pass through the given names, which is
 * what makes the pairs distinct: 24 × 20 = 480 people before any pair comes
 * back, and a run is capped well under that.
 *
 * @param index zero-based position of the person in the run
 */
export function nameAt(index: number): string {
  const given = GIVEN_NAMES[index % GIVEN_NAMES.length];
  const family = FAMILY_NAMES[Math.floor(index / GIVEN_NAMES.length) % FAMILY_NAMES.length];

  // Unreachable: both operands of `%` are the length of a non-empty literal
  // array. The guard is here because `noUncheckedIndexedAccess` is on and a
  // silent `undefined` in a patient's name is worse than a loud throw.
  if (given === undefined || family === undefined) {
    throw new Error(`no name for index ${index}: the name pools are empty`);
  }

  return `${given} ${family}`;
}

/**
 * The e-mail of a person, built from a code and never from the name: the name
 * is invented, but an address derived from one still reads as a personal
 * address, and this way every local part is plainly a serial number.
 *
 * @param code the person's code in the run, such as `PAC-007`
 */
export function emailFor(code: string): string {
  return `${code.toLowerCase()}@${EMAIL_DOMAIN}`;
}
