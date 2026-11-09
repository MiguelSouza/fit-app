import {
  ConsentNotInForceError,
  HealthDataConsentRequiredError,
  MissingRequiredConsentError,
} from './identity-errors';
import {
  consentsInForceOrder,
  consentsToGrant,
  consentsToRevoke,
  consentToGrant,
  CURRENT_TERMS_VERSION,
  REQUIRED_CONSENTS,
  type ConsentType,
} from './consent';

/**
 * The consents of an acceptance, as the domain decides them (card I-03).
 *
 * The acceptance criterion this file carries is the first one: "sem
 * `health_data` e `share_with_professional`, o aceite falha". It is a unit test
 * because the rule is pure — no database, no HTTP, nothing to mock (CLAUDE.md,
 * "Testes": the domain's tests are mandatory).
 */
const NOW = new Date('2026-10-30T12:00:00Z');

describe('consentsToGrant', () => {
  it('grants the two required consents with the version of the terms', () => {
    expect(consentsToGrant(['health_data', 'share_with_professional'], NOW)).toEqual([
      { type: 'health_data', termsVersion: CURRENT_TERMS_VERSION, grantedAt: NOW },
      { type: 'share_with_professional', termsVersion: CURRENT_TERMS_VERSION, grantedAt: NOW },
    ]);
  });

  it('grants the optional ones when the patient ticked them', () => {
    const granted = consentsToGrant(
      ['health_data', 'share_with_professional', 'wearable_data', 'ai_processing'],
      NOW,
    );

    expect(granted.map((consent) => consent.type)).toEqual([
      'health_data',
      'share_with_professional',
      'wearable_data',
      'ai_processing',
    ]);
  });

  it('accepts the required two with neither optional one: both are optional at this moment', () => {
    const granted = consentsToGrant([...REQUIRED_CONSENTS], NOW);

    expect(granted.map((consent) => consent.type)).not.toContain('wearable_data');
    expect(granted.map((consent) => consent.type)).not.toContain('ai_processing');
  });

  it('refuses the acceptance when health_data is missing', () => {
    expect(() => consentsToGrant(['share_with_professional'], NOW)).toThrow(
      MissingRequiredConsentError,
    );
  });

  it('refuses the acceptance when share_with_professional is missing', () => {
    expect(() => consentsToGrant(['health_data', 'wearable_data'], NOW)).toThrow(
      MissingRequiredConsentError,
    );
  });

  it('refuses an acceptance that consented to nothing', () => {
    expect(() => consentsToGrant([], NOW)).toThrow(MissingRequiredConsentError);
  });

  it('says which purposes are missing, in the words the screen used', () => {
    try {
      consentsToGrant(['wearable_data'], NOW);
      throw new Error('the acceptance was not refused');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingRequiredConsentError);
      expect((error as MissingRequiredConsentError).code).toBe('identity.consent.required_missing');
      expect((error as Error).message).toBe(
        'Para aceitar o convite é preciso concordar com o uso dos seus dados de saúde e ' +
          'o compartilhamento com o seu profissional.',
      );
    }
  });

  it('collapses a purpose the client sent twice: it is one consent', () => {
    const granted = consentsToGrant(['health_data', 'health_data', 'share_with_professional'], NOW);

    expect(granted).toHaveLength(2);
  });

  it('grants every consent at the instant of the acceptance', () => {
    const granted = consentsToGrant(['health_data', 'share_with_professional'], NOW);

    expect(granted.every((consent) => consent.grantedAt === NOW)).toBe(true);
  });
});

/**
 * Giving and taking back one purpose, as the domain decides it (card I-05).
 *
 * These are the rules the two use cases rest on, and all three of them are
 * pure: granting something already in force is nothing to write, revoking
 * `health_data` takes every other purpose with it, and no purpose may be in
 * force without `health_data` under it.
 */
describe('consentToGrant', () => {
  it('writes the purpose with the current version of the terms', () => {
    expect(consentToGrant('wearable_data', ['health_data'], NOW)).toEqual({
      type: 'wearable_data',
      termsVersion: CURRENT_TERMS_VERSION,
      grantedAt: NOW,
    });
  });

  it('writes nothing for a purpose that is already in force', () => {
    // A double tap, or a retry on a flaky connection: the same state of the
    // world, and the caller answers the consent that is already there.
    expect(consentToGrant('ai_processing', ['health_data', 'ai_processing'], NOW)).toBeUndefined();
  });

  it('lets health_data be given to a patient who holds nothing', () => {
    // The way back after revoking everything: the foundation first.
    expect(consentToGrant('health_data', [], NOW)).toMatchObject({ type: 'health_data' });
  });

  it('refuses a purpose built on health_data while health_data is not in force', () => {
    expect(() => consentToGrant('share_with_professional', [], NOW)).toThrow(
      HealthDataConsentRequiredError,
    );
    expect(() => consentToGrant('wearable_data', ['ai_processing'], NOW)).toThrow(
      HealthDataConsentRequiredError,
    );
  });
});

describe('consentsToRevoke', () => {
  it('revokes only the purpose asked for', () => {
    expect(
      consentsToRevoke('wearable_data', [
        'health_data',
        'share_with_professional',
        'wearable_data',
      ]),
    ).toEqual(['wearable_data']);
  });

  it('revokes every purpose in force when health_data goes', () => {
    // "Revogar `health_data` encerra o uso do app": every other purpose is
    // something done to data the platform may no longer keep.
    expect(
      consentsToRevoke('health_data', ['ai_processing', 'share_with_professional', 'health_data']),
    ).toEqual(['health_data', 'share_with_professional', 'ai_processing']);
  });

  it('revokes health_data alone when nothing else is in force', () => {
    expect(consentsToRevoke('health_data', ['health_data'])).toEqual(['health_data']);
  });

  it('leaves a purpose that was already revoked out of the cascade', () => {
    // The row of a revoked consent stays forever, and it is not in force: the
    // cascade has nothing to do to it, and revoking it twice would write a
    // second `revoked_at` over the first.
    expect(consentsToRevoke('health_data', ['health_data', 'wearable_data'])).toEqual([
      'health_data',
      'wearable_data',
    ]);
  });

  it('refuses to revoke a purpose that is not in force', () => {
    expect(() => consentsToRevoke('ai_processing', ['health_data'])).toThrow(
      ConsentNotInForceError,
    );
    expect(() => consentsToRevoke('health_data', [])).toThrow(ConsentNotInForceError);
  });
});

describe('consentsInForceOrder', () => {
  it('answers the purposes in the order the product talks about them', () => {
    const consents = ['ai_processing', 'health_data', 'wearable_data'].map((type) => ({
      type: type as ConsentType,
      termsVersion: CURRENT_TERMS_VERSION,
      grantedAt: NOW,
    }));

    expect(consentsInForceOrder(consents).map((consent) => consent.type)).toEqual([
      'health_data',
      'wearable_data',
      'ai_processing',
    ]);
  });

  it('leaves the list it was given alone', () => {
    const consents = [
      { type: 'wearable_data' as ConsentType, termsVersion: '1.0', grantedAt: NOW },
      { type: 'health_data' as ConsentType, termsVersion: '1.0', grantedAt: NOW },
    ];

    consentsInForceOrder(consents);

    expect(consents.map((consent) => consent.type)).toEqual(['wearable_data', 'health_data']);
  });
});
