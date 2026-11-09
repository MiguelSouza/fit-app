import {
  type Consent as ConsentDto,
  type ConsentList,
  type ConsentType as ConsentTypeDto,
  type RevokedConsent as RevokedConsentDto,
  type RevokedConsentList,
} from '@fit-app/contracts';

import { type ConsentInForce, type ConsentType, type RevokedConsent } from '../domain/consent';

/**
 * The domain's consents as the contract answers them (card I-05).
 *
 * Two things happen here and nowhere else. The instants become ISO 8601 text
 * in UTC, which is what the contract declares and what every client parses
 * (CLAUDE.md, "Dados de saúde"). And the two vocabularies are checked against
 * each other: the domain declares its own four purposes (`domain/consent.ts`)
 * and the assignment below only compiles while the contract still has every
 * value the domain can produce.
 *
 * What does **not** cross over is the row id. The patient holds one consent in
 * force per purpose, so the purpose names it; an id in the answer would only
 * invite a client to start sending it back.
 */
export function toConsentResponse(consent: ConsentInForce): ConsentDto {
  return {
    type: toConsentType(consent.type),
    termsVersion: consent.termsVersion,
    grantedAt: consent.grantedAt.toISOString(),
  };
}

/** The list, in the order the use case answered it: the order of the purposes. */
export function toConsentListResponse(consents: readonly ConsentInForce[]): ConsentList {
  return { consents: consents.map(toConsentResponse) };
}

/**
 * One revoked consent: the row that stayed, with both instants on it.
 *
 * `grantedAt` and `termsVersion` are the original ones, untouched — which is
 * the acceptance criterion "revogação nunca apaga o registro original", made
 * visible from outside the database.
 */
export function toRevokedConsentResponse(revoked: RevokedConsent): RevokedConsentDto {
  return { ...toConsentResponse(revoked), revokedAt: revoked.revokedAt.toISOString() };
}

/**
 * What the revocation ended: one purpose, or every one of them when
 * `health_data` goes.
 */
export function toRevokedConsentListResponse(
  revoked: readonly RevokedConsent[],
): RevokedConsentList {
  return { revoked: revoked.map(toRevokedConsentResponse) };
}

/** Where the domain's purposes and the contract's are checked to be the same word. */
function toConsentType(type: ConsentType): ConsentTypeDto {
  return type;
}
