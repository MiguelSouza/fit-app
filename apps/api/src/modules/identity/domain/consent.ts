import { MissingRequiredConsentError } from './identity-errors';

/**
 * What the patient consents to, and what the platform records about it
 * (card I-03).
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
