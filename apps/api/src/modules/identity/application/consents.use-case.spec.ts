import { RecordingEventBus } from '../../../shared/events/recording-event-bus.spec-support';
import { CURRENT_TERMS_VERSION, type ConsentType } from '../domain/consent';
import {
  CallerIsNotPatientError,
  ConsentNotInForceError,
  HealthDataConsentRequiredError,
  ProfileNotFoundError,
} from '../domain/identity-errors';
import { GrantConsentUseCase } from './grant-consent.use-case';
import { InMemoryConsentRepository } from './in-memory-consent-repository.spec-support';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from './in-memory-identity-registry.spec-support';
import { ListMyConsentsUseCase } from './list-my-consents.use-case';
import { LoadPatientCaller } from './load-patient-caller';
import { RevokeConsentUseCase } from './revoke-consent.use-case';

/**
 * The three consent use cases, driven without a database (card I-05).
 *
 * What is covered here is the wiring the domain rules hang off: who may call,
 * that granting is idempotent, that a revocation dates the row instead of
 * removing it, and that `identity.consent.revoked` goes out once per purpose
 * the revocation ended. What only a real Postgres can prove — the partial
 * unique index, the cascade as one transaction, and the professional losing
 * access on the next request — is the integration suite next door (CLAUDE.md,
 * "Testes").
 *
 * No data of a real person: the ids are random and a purpose is a code.
 */
const PATIENT_AUTH_USER_ID = 'auth-user-of-the-patient';
const PROFESSIONAL_AUTH_USER_ID = 'auth-user-of-the-professional';

interface Fixture {
  readonly profileId: string;
  readonly consents: InMemoryConsentRepository;
  readonly events: RecordingEventBus;
  readonly list: ListMyConsentsUseCase;
  readonly grant: GrantConsentUseCase;
  readonly revoke: RevokeConsentUseCase;
}

/** A patient who already holds the purposes the acceptance required. */
function aPatientHolding(...inForce: readonly ConsentType[]): Fixture {
  const patient = patientIdentity();

  const registry = new InMemoryIdentityRegistry({
    [PATIENT_AUTH_USER_ID]: patient,
    [PROFESSIONAL_AUTH_USER_ID]: professionalIdentity(),
  });

  const consents = new InMemoryConsentRepository(patient.personId, inForce);
  const events = new RecordingEventBus();
  const caller = new LoadPatientCaller(registry);

  return {
    profileId: patient.personId,
    consents,
    events,
    list: new ListMyConsentsUseCase(caller, consents),
    grant: new GrantConsentUseCase(caller, consents),
    revoke: new RevokeConsentUseCase(caller, consents, events),
  };
}

describe('ListMyConsentsUseCase', () => {
  it('answers what is in force, in the order of the purposes', async () => {
    const { list } = aPatientHolding('ai_processing', 'health_data');

    const consents = await list.execute(PATIENT_AUTH_USER_ID);

    expect(consents.map((consent) => consent.type)).toEqual(['health_data', 'ai_processing']);
    expect(consents[0]?.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('leaves out what was revoked: the row stays, the consent does not', async () => {
    const { list, revoke } = aPatientHolding('health_data', 'wearable_data');

    await revoke.execute(PATIENT_AUTH_USER_ID, 'wearable_data');

    expect((await list.execute(PATIENT_AUTH_USER_ID)).map((consent) => consent.type)).toEqual([
      'health_data',
    ]);
  });

  it('refuses a professional: the consents are the patient own', async () => {
    const { list } = aPatientHolding('health_data');

    await expect(list.execute(PROFESSIONAL_AUTH_USER_ID)).rejects.toThrow(CallerIsNotPatientError);
  });

  it('refuses whoever signed in and never finished the first access', async () => {
    const { list } = aPatientHolding('health_data');

    await expect(list.execute('auth-user-with-no-profile')).rejects.toThrow(ProfileNotFoundError);
  });
});

describe('GrantConsentUseCase', () => {
  it('records the purpose with the version of the terms the API decided', async () => {
    const { grant } = aPatientHolding('health_data');

    const granted = await grant.execute(PATIENT_AUTH_USER_ID, 'wearable_data');

    expect(granted).toMatchObject({
      type: 'wearable_data',
      termsVersion: CURRENT_TERMS_VERSION,
    });
  });

  it('writes nothing for a purpose already in force and keeps the original date', async () => {
    const { grant, consents } = aPatientHolding('health_data', 'ai_processing');
    const [, original] = consents.rows;

    const granted = await grant.execute(PATIENT_AUTH_USER_ID, 'ai_processing');

    expect(consents.rows).toHaveLength(2);
    expect(granted.grantedAt).toEqual(original?.grantedAt);
  });

  it('refuses a purpose that rests on health_data when health_data is gone', async () => {
    const { grant, revoke } = aPatientHolding('health_data', 'share_with_professional');

    await revoke.execute(PATIENT_AUTH_USER_ID, 'health_data');

    await expect(grant.execute(PATIENT_AUTH_USER_ID, 'ai_processing')).rejects.toThrow(
      HealthDataConsentRequiredError,
    );
  });

  it('lets the patient start again from health_data after revoking it', async () => {
    const { grant, revoke, list } = aPatientHolding('health_data', 'share_with_professional');

    await revoke.execute(PATIENT_AUTH_USER_ID, 'health_data');

    await grant.execute(PATIENT_AUTH_USER_ID, 'health_data');
    await grant.execute(PATIENT_AUTH_USER_ID, 'share_with_professional');

    expect((await list.execute(PATIENT_AUTH_USER_ID)).map((consent) => consent.type)).toEqual([
      'health_data',
      'share_with_professional',
    ]);
  });

  it('refuses a professional', async () => {
    const { grant } = aPatientHolding('health_data');

    await expect(grant.execute(PROFESSIONAL_AUTH_USER_ID, 'wearable_data')).rejects.toThrow(
      CallerIsNotPatientError,
    );
  });
});

describe('RevokeConsentUseCase', () => {
  it('never removes the original record: it dates it', async () => {
    // The card's first acceptance criterion. The row keeps `grantedAt` and the
    // version of the terms it was given against, and gains `revokedAt`.
    const { revoke, consents } = aPatientHolding('health_data', 'wearable_data');
    const [, original] = consents.rows;

    const [revoked] = await revoke.execute(PATIENT_AUTH_USER_ID, 'wearable_data');

    expect(consents.rows).toHaveLength(2);
    expect(revoked).toMatchObject({
      type: 'wearable_data',
      termsVersion: original?.termsVersion,
      grantedAt: original?.grantedAt,
    });
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });

  it('publishes identity.consent.revoked with the profile and the purpose', async () => {
    const { revoke, events, profileId } = aPatientHolding('health_data', 'ai_processing');

    const [revoked] = await revoke.execute(PATIENT_AUTH_USER_ID, 'ai_processing');

    expect(events.payloadsOf('identity.consent.revoked')).toEqual([
      {
        profileId,
        consentType: 'ai_processing',
        revokedAt: revoked?.revokedAt.toISOString(),
      },
    ]);
  });

  it('carries no personal data in the payload: an id, a code and an instant', async () => {
    const { revoke, events } = aPatientHolding('health_data');

    await revoke.execute(PATIENT_AUTH_USER_ID, 'health_data');

    // CLAUDE.md, "Saúde e LGPD": a payload is read by a handler that may log
    // it, enqueue it or send it to a provider.
    for (const payload of events.payloadsOf('identity.consent.revoked')) {
      expect(Object.keys(payload).sort()).toEqual(['consentType', 'profileId', 'revokedAt']);
    }
  });

  it('ends every purpose in force when health_data goes, and announces each one', async () => {
    // "Revogar `health_data` encerra o uso do app" (card I-05).
    const { revoke, events, list } = aPatientHolding(
      'health_data',
      'share_with_professional',
      'wearable_data',
      'ai_processing',
    );

    const revoked = await revoke.execute(PATIENT_AUTH_USER_ID, 'health_data');

    expect(revoked.map((consent) => consent.type)).toEqual([
      'health_data',
      'share_with_professional',
      'wearable_data',
      'ai_processing',
    ]);
    expect(
      events.payloadsOf('identity.consent.revoked').map((payload) => payload.consentType),
    ).toEqual(['health_data', 'share_with_professional', 'wearable_data', 'ai_processing']);
    expect(await list.execute(PATIENT_AUTH_USER_ID)).toEqual([]);
  });

  it('leaves the other purposes alone when one of them is revoked', async () => {
    const { revoke, list } = aPatientHolding(
      'health_data',
      'share_with_professional',
      'wearable_data',
    );

    await revoke.execute(PATIENT_AUTH_USER_ID, 'share_with_professional');

    expect((await list.execute(PATIENT_AUTH_USER_ID)).map((consent) => consent.type)).toEqual([
      'health_data',
      'wearable_data',
    ]);
  });

  it('refuses a purpose that is not in force, and announces nothing', async () => {
    const { revoke, events } = aPatientHolding('health_data');

    await expect(revoke.execute(PATIENT_AUTH_USER_ID, 'wearable_data')).rejects.toThrow(
      ConsentNotInForceError,
    );
    expect(events.published).toEqual([]);
  });

  it('refuses the second revocation of the same purpose', async () => {
    const { revoke } = aPatientHolding('health_data', 'wearable_data');

    await revoke.execute(PATIENT_AUTH_USER_ID, 'wearable_data');

    await expect(revoke.execute(PATIENT_AUTH_USER_ID, 'wearable_data')).rejects.toThrow(
      ConsentNotInForceError,
    );
  });

  it('refuses a professional: nothing a professional holds stops a revocation', async () => {
    const { revoke } = aPatientHolding('health_data');

    await expect(revoke.execute(PROFESSIONAL_AUTH_USER_ID, 'health_data')).rejects.toThrow(
      CallerIsNotPatientError,
    );
  });
});
