import { emailFor, ORGANIZATION_NAME, ORGANIZATION_SLUG, PROFESSIONAL_NAME } from './names.ts';
import { generatePatient } from './patient.ts';
import { profileFor, type ProfileId } from './profiles.ts';
import { createRandom } from './random.ts';
import type { SyntheticOrganization, SyntheticPatient, SyntheticProfessional } from './records.ts';
import { dateMinusDays, DEFAULT_TIMEZONE, instantAt, isLocalDate, type LocalDate } from './time.ts';

/**
 * The whole dataset: one organization, one nutritionist, and N patients with
 * their 90 days.
 *
 * Reproducible from `options` alone. Nothing here reads the clock, the
 * environment or the disk — the caller decides the end of the window — so two
 * runs with the same options produce byte-identical output, which is what
 * `test/determinism.test.ts` checks and what makes "look at PAC-004" a
 * sentence two people can act on.
 */

export interface DatasetOptions {
  readonly patients: number;
  readonly seed: number;
  readonly days: number;

  /** Last day of the window, inclusive, as a local date. */
  readonly endDate: LocalDate;

  /** The time zone the patients live in. */
  readonly timezone?: string;
}

/** What a run was, in the output, so it can be reproduced exactly. */
export interface DatasetManifest {
  readonly generator: string;
  readonly seed: number;
  readonly days: number;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly timezone: string;
  readonly patientCount: number;

  /** Which profile each patient got, by code. */
  readonly profiles: readonly { readonly code: string; readonly profile: ProfileId }[];
}

export interface SyntheticDataset {
  readonly manifest: DatasetManifest;
  readonly organization: SyntheticOrganization;
  readonly professional: SyntheticProfessional;
  readonly patients: readonly SyntheticPatient[];
}

/** How long before the window opens the patients were enrolled. */
const ENROLLED_DAYS_BEFORE = 30;

/** The most patients one run will produce: under the 480 distinct names. */
export const MAX_PATIENTS = 400;

export function generateDataset(options: DatasetOptions): SyntheticDataset {
  const { patients, seed, days, endDate } = options;
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;

  if (!Number.isInteger(patients) || patients < 1 || patients > MAX_PATIENTS) {
    throw new Error(`patients has to be an integer between 1 and ${MAX_PATIENTS}, got ${patients}`);
  }

  if (!Number.isInteger(days) || days < 7 || days > 730) {
    throw new Error(`days has to be an integer between 7 and 730, got ${days}`);
  }

  if (!Number.isInteger(seed)) throw new Error(`seed has to be an integer, got ${seed}`);

  if (!isLocalDate(endDate))
    throw new Error(`end-date has to be a YYYY-MM-DD date, got ${endDate}`);

  const master = createRandom(seed);

  // The clinic draws from a stream of its own, so adding a patient never
  // shifts the ids of the organization or of the professional.
  const clinic = master.stream('organization');

  const organization: SyntheticOrganization = {
    id: clinic.uuid(),
    name: ORGANIZATION_NAME,
    slug: ORGANIZATION_SLUG,
    synthetic: true,
  };

  const professionalCode = 'NUT-001';
  const professional: SyntheticProfessional = {
    id: clinic.uuid(),
    organizationId: organization.id,
    code: professionalCode,
    // Its own name, outside the patient pools, so no patient shares
    // it.
    name: PROFESSIONAL_NAME,
    email: emailFor(professionalCode),
    professionalType: 'nutritionist',
    synthetic: true,
  };

  const startDate = dateMinusDays(endDate, days - 1);
  const enrolledAt = instantAt(dateMinusDays(startDate, ENROLLED_DAYS_BEFORE), 9, 0, timezone);

  const generated = Array.from({ length: patients }, (_unused, index) =>
    generatePatient({
      index,
      profile: profileFor(index),
      // The label, and not the position in a shared stream, is what a
      // patient's data hangs off: `--patients 20` therefore contains the same
      // people as `--patients 5`, plus fifteen more.
      random: master.stream(`patient:${index}`),
      days,
      endDate,
      timezone,
      organizationId: organization.id,
      professionalId: professional.id,
      enrolledAt,
    }),
  );

  return {
    manifest: {
      generator: '@fit-app/scripts seed:synthetic',
      seed,
      days,
      startDate,
      endDate,
      timezone,
      patientCount: generated.length,
      profiles: generated.map(({ code, profile }) => ({ code, profile })),
    },
    organization,
    professional,
    patients: generated,
  };
}
