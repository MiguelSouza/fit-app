import { MissingRequiredConsentError } from './identity-errors';
import { consentsToGrant, CURRENT_TERMS_VERSION, REQUIRED_CONSENTS } from './consent';

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
