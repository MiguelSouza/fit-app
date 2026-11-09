import {
  ConsentNotInForceError,
  HealthDataConsentRequiredError,
  MissingRequiredConsentError,
} from './identity-errors';

/**
 * What the patient consents to, and what the platform records about it
 * (cards I-03 and I-05).
 *
 * Pure: no NestJS, no Drizzle, no I/O (CLAUDE.md rule 4). The vocabulary is
 * declared here and not imported from `@fit-app/contracts`, as `person.ts`
 * next door declares its own: the rules are written against the domain, and
 * the contract is one of its readers — the two are checked against each other
 * at the boundary, by the controller and by the presenter.
 */

/**
 * A purpose. One consent per purpose, each given and revoked on its own, which
 * is what LGPD's "consentimento por finalidade" means in a column.
 */
export type ConsentType =
  'health_data' | 'share_with_professional' | 'wearable_data' | 'ai_processing';

/**
 * The two a patient cannot join without.
 *
 * `health_data` is the platform: without it there is nothing to keep and
 * nothing to process. `share_with_professional` is the point of the
 * invitation: a link the professional may not read through would leave the
 * patient filling in check-ins nobody can see, and every use case that opens a
 * chart would refuse (CLAUDE.md, "Saúde e LGPD").
 *
 * `wearable_data` and `ai_processing` are **not** here, deliberately: the card
 * makes them optional at this moment, and a patient who declines both still
 * gets the whole of the nutritionist's follow-up.
 */
export const REQUIRED_CONSENTS: readonly ConsentType[] = ['health_data', 'share_with_professional'];

/**
 * The version of the terms the platform is asking agreement to, recorded on
 * every consent it writes.
 *
 * It is decided here and not sent by the client: what the patient agreed to is
 * the text this API served, and a field in the request would let a caller
 * record agreement to a version that was never shown. When the terms change,
 * this constant moves and the consents already in force keep saying which text
 * they were given against — which is the whole reason the column exists.
 */
export const CURRENT_TERMS_VERSION = '1.0';

/** A consent as it gets written: the purpose, the text, and when it was given. */
export interface ConsentToGrant {
  readonly type: ConsentType;
  readonly termsVersion: string;
  readonly grantedAt: Date;
}

/**
 * The consents of an acceptance, from what the patient ticked.
 *
 * Repeated values are the same consent and are collapsed, and the order the
 * client sent them in is kept — it makes a failure readable and costs nothing.
 *
 * @param requested the purposes the patient agreed to
 * @param now the instant of the acceptance, which every consent is granted at
 * @throws MissingRequiredConsentError when `health_data` or
 *   `share_with_professional` is not among them. It is the acceptance
 *   criterion "sem `health_data` e `share_with_professional`, o aceite falha",
 *   and it is here — in the domain — so that it holds for the panel, for the
 *   app and for anything else that ever calls the API.
 */
export function consentsToGrant(
  requested: readonly ConsentType[],
  now: Date,
): readonly ConsentToGrant[] {
  const types = [...new Set(requested)];
  const missing = REQUIRED_CONSENTS.filter((required) => !types.includes(required));

  if (missing.length > 0) throw new MissingRequiredConsentError(missing);

  return types.map((type) => ({ type, termsVersion: CURRENT_TERMS_VERSION, grantedAt: now }));
}

/**
 * Every purpose, in the order the platform talks about them: the foundation
 * first, then what is built on it.
 *
 * It is the order a list of consents comes back in and the order a cascade
 * revokes in, so that two requests with the same effect read the same in a log
 * and in a test. Appending a purpose to `ConsentType` without adding it here
 * stops the build, because the array is typed against the union below.
 */
export const CONSENT_TYPES: readonly ConsentType[] = [
  'health_data',
  'share_with_professional',
  'wearable_data',
  'ai_processing',
];

/**
 * The purpose everything else rests on.
 *
 * `health_data` is not one finalidade among four: it is permission to keep and
 * process the patient's health data at all. Sharing it with a professional,
 * importing it from a wearable and sending it to the AI copilot are things
 * done **to** that data, so none of them can be in force without it — which is
 * what makes revoking it "encerrar o uso do app" (card I-05) rather than one
 * switch among others.
 */
export const FOUNDATIONAL_CONSENT: ConsentType = 'health_data';

/**
 * A consent in force: the same three facts as one being written, read back.
 *
 * An alias and not a second interface with the same three fields: what the
 * platform records about a consent is exactly what it knows about it, and two
 * declarations would only drift. The name earns its place at the ports and in
 * the presenter, where "in force" is the question being answered.
 */
export type ConsentInForce = ConsentToGrant;

/** The same row after a revocation. It is never deleted, only dated. */
export interface RevokedConsent extends ConsentInForce {
  readonly revokedAt: Date;
}

/**
 * What a patient has in force, in the canonical order of `CONSENT_TYPES`.
 *
 * The database has no opinion about the order of rows, and the list the app
 * draws should not change between two identical requests. Sorting is here and
 * not in an `order by` because the order is the product's — the one declared
 * above — and not something an index happens to give.
 */
export function consentsInForceOrder(
  consents: readonly ConsentInForce[],
): readonly ConsentInForce[] {
  return [...consents].sort(
    (one, other) => CONSENT_TYPES.indexOf(one.type) - CONSENT_TYPES.indexOf(other.type),
  );
}

/**
 * The consent to write when the patient gives one purpose, or `undefined` when
 * there is nothing to write (card I-05).
 *
 * `undefined` and not an error for a purpose already in force: giving a
 * consent twice is the same state of the world, and the app that sends the
 * request twice — a double tap, a retry on a flaky connection — must not be
 * told it did something wrong. The caller answers the consent that is already
 * there, with the date and the version it really has.
 *
 * The version of the terms is `CURRENT_TERMS_VERSION`, decided here and never
 * sent by the client, for the reason written on that constant.
 *
 * @param type the purpose the patient is consenting to
 * @param inForce the purposes they already hold
 * @param now the instant of the request, which the consent is granted at
 * @throws HealthDataConsentRequiredError when the purpose is built on
 *   `health_data` and that one is not in force. It is the other half of
 *   "revogar `health_data` encerra o uso do app": without the rule, a patient
 *   who revoked it could turn `ai_processing` back on and the platform would
 *   be processing data it has no permission to keep.
 */
export function consentToGrant(
  type: ConsentType,
  inForce: readonly ConsentType[],
  now: Date,
): ConsentToGrant | undefined {
  if (inForce.includes(type)) return undefined;

  if (type !== FOUNDATIONAL_CONSENT && !inForce.includes(FOUNDATIONAL_CONSENT)) {
    throw new HealthDataConsentRequiredError();
  }

  return { type, termsVersion: CURRENT_TERMS_VERSION, grantedAt: now };
}

/**
 * The purposes one revocation takes back (card I-05).
 *
 * One purpose for every finalidade except the foundational one, and **every
 * purpose in force** for `health_data`: the platform may no longer keep the
 * data, so there is nothing left for a professional to be shown, for a
 * wearable to feed or for the AI to read. The cascade is decided here, in the
 * domain, and written in one transaction by the repository — a patient who
 * revoked `health_data` and kept `ai_processing` on is a state nobody should
 * be able to reach, not even by half a failed request.
 *
 * What a revocation does **not** do is end the care relationship. The link is
 * the audit trail of why a practice ever saw this patient (ADR 0016), and the
 * access rule already answers no the instant `share_with_professional` stops
 * being in force (ADR 0017) — ending the follow-up is the practice's own act,
 * and erasing the data is a different right, with a different card.
 *
 * @param type the purpose the patient is revoking
 * @param inForce the purposes they hold at this instant
 * @returns the purposes to revoke, in the order of `CONSENT_TYPES`
 * @throws ConsentNotInForceError when that purpose is not in force. There is
 *   nothing to take back, and answering "pronto" would tell the patient the
 *   platform just stopped doing something it had already stopped doing.
 */
export function consentsToRevoke(
  type: ConsentType,
  inForce: readonly ConsentType[],
): readonly ConsentType[] {
  if (!inForce.includes(type)) throw new ConsentNotInForceError();

  if (type !== FOUNDATIONAL_CONSENT) return [type];

  return CONSENT_TYPES.filter((candidate) => inForce.includes(candidate));
}
