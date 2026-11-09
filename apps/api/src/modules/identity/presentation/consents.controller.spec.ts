import { type INestApplication } from '@nestjs/common';
import { consentListSchema, consentSchema, revokedConsentListSchema } from '@fit-app/contracts';
import request from 'supertest';

import {
  signAccessToken,
  TEST_USER_ID,
} from '../../../shared/auth/local-access-token.spec-support';
import { InMemoryConsentRepository } from '../application/in-memory-consent-repository.spec-support';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from '../application/in-memory-identity-registry.spec-support';
import { CURRENT_TERMS_VERSION, type ConsentType } from '../domain/consent';
import { bootAppWith } from './identity-app.spec-support';

/**
 * The three routes of `/v1/me/consents` over the real `AppModule`, with the
 * identity registry and the consent repository as the only seams
 * (`identity-app.spec-support.ts`).
 *
 * What this suite is about is the HTTP surface: the status codes, the shape of
 * the bodies as the contract declares them, and who gets refused. The rules
 * themselves are the domain's and are covered as unit tests; the SQL is the
 * integration suite's.
 *
 * None of the routes is `@Public()`, so the global guard answers 401 without a
 * token (ADR 0007), and the token is signed with the same secret the
 * environment carries — with the `sub` the registry was seeded for, which is
 * how a test proves the answer is about the caller.
 */
function aPatient(...inForce: readonly ConsentType[]) {
  const patient = patientIdentity();
  const registry = new InMemoryIdentityRegistry({ [TEST_USER_ID]: patient });

  return { registry, consents: new InMemoryConsentRepository(patient.personId, inForce) };
}

describe('GET /v1/me/consents', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('answers the purposes in force, with the date and the version of the terms', async () => {
    const { registry, consents } = aPatient('health_data', 'share_with_professional');
    app = await bootAppWith(registry, { consents });

    const response = await request(app.getHttpServer())
      .get('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      consents: [
        {
          type: 'health_data',
          termsVersion: CURRENT_TERMS_VERSION,
          grantedAt: '2026-11-01T12:00:00.000Z',
        },
        {
          type: 'share_with_professional',
          termsVersion: CURRENT_TERMS_VERSION,
          grantedAt: '2026-11-01T12:00:00.000Z',
        },
      ],
    });

    // What the app will do with it: read it as the contract.
    expect(consentListSchema.safeParse(response.body).success).toBe(true);
  });

  it('answers an empty list for a patient who holds nothing', async () => {
    const { registry, consents } = aPatient();
    app = await bootAppWith(registry, { consents });

    const response = await request(app.getHttpServer())
      .get('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    expect(response.body).toEqual({ consents: [] });
  });

  it('answers 403 for a professional: the consents are the patient own', async () => {
    const registry = new InMemoryIdentityRegistry({ [TEST_USER_ID]: professionalIdentity() });
    app = await bootAppWith(registry, { consents: new InMemoryConsentRepository('unused') });

    const response = await request(app.getHttpServer())
      .get('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(403);

    expect(response.body.error.code).toBe('identity.patient.required');
  });

  it('answers 404 for whoever signed in and never finished the first access', async () => {
    app = await bootAppWith(new InMemoryIdentityRegistry(), {
      consents: new InMemoryConsentRepository('unused'),
    });

    const response = await request(app.getHttpServer())
      .get('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(404);

    expect(response.body.error.code).toBe('identity.profile.not_found');
  });

  it('answers 401 without a token, like every route that is not public', async () => {
    const { registry, consents } = aPatient('health_data');
    app = await bootAppWith(registry, { consents });

    await request(app.getHttpServer()).get('/v1/me/consents').expect(401);
  });
});

describe('POST /v1/me/consents', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('answers 201 and the consent, with the version the API decided', async () => {
    const { registry, consents } = aPatient('health_data');
    app = await bootAppWith(registry, { consents });

    const response = await request(app.getHttpServer())
      .post('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .send({ type: 'wearable_data' })
      .expect(201);

    expect(response.body).toMatchObject({
      type: 'wearable_data',
      termsVersion: CURRENT_TERMS_VERSION,
    });
    expect(consentSchema.safeParse(response.body).success).toBe(true);
  });

  it('ignores a version of the terms somebody tries to send', async () => {
    // What the patient agreed to is the text this API served. The serializer
    // and the validation pipe drop what the schema does not declare, which is
    // why there is no field for it to land in.
    const { registry, consents } = aPatient('health_data');
    app = await bootAppWith(registry, { consents });

    const response = await request(app.getHttpServer())
      .post('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .send({ type: 'ai_processing', termsVersion: '0.1' })
      .expect(201);

    expect(response.body.termsVersion).toBe(CURRENT_TERMS_VERSION);
  });

  it('answers 422 for a purpose that rests on health_data when it is not in force', async () => {
    const { registry, consents } = aPatient();
    app = await bootAppWith(registry, { consents });

    const response = await request(app.getHttpServer())
      .post('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .send({ type: 'ai_processing' })
      .expect(422);

    expect(response.body.error.code).toBe('identity.consent.health_data_required');
  });

  it('answers 400 for a purpose the platform does not have', async () => {
    const { registry, consents } = aPatient('health_data');
    app = await bootAppWith(registry, { consents });

    await request(app.getHttpServer())
      .post('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .send({ type: 'sell_to_whoever_pays' })
      .expect(400);
  });
});

describe('POST /v1/me/consents/{type}/revoke', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('answers the consent it ended, with both instants and the original version', async () => {
    const { registry, consents } = aPatient('health_data', 'wearable_data');
    app = await bootAppWith(registry, { consents });

    const response = await request(app.getHttpServer())
      .post('/v1/me/consents/wearable_data/revoke')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    expect(response.body.revoked).toHaveLength(1);
    expect(response.body.revoked[0]).toMatchObject({
      type: 'wearable_data',
      termsVersion: CURRENT_TERMS_VERSION,
      grantedAt: '2026-11-01T12:00:00.000Z',
    });
    expect(response.body.revoked[0].revokedAt).toEqual(expect.any(String));
    expect(revokedConsentListSchema.safeParse(response.body).success).toBe(true);
  });

  it('ends every purpose in force when health_data is revoked', async () => {
    const { registry, consents } = aPatient(
      'health_data',
      'share_with_professional',
      'wearable_data',
    );
    app = await bootAppWith(registry, { consents });

    const response = await request(app.getHttpServer())
      .post('/v1/me/consents/health_data/revoke')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    expect(response.body.revoked.map((consent: { type: string }) => consent.type)).toEqual([
      'health_data',
      'share_with_professional',
      'wearable_data',
    ]);

    // And nothing is left in force, which is "encerra o uso do app".
    const afterwards = await request(app.getHttpServer())
      .get('/v1/me/consents')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    expect(afterwards.body).toEqual({ consents: [] });
  });

  it('answers 409 for a purpose that is not in force', async () => {
    const { registry, consents } = aPatient('health_data');
    app = await bootAppWith(registry, { consents });

    const response = await request(app.getHttpServer())
      .post('/v1/me/consents/ai_processing/revoke')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(409);

    expect(response.body.error.code).toBe('identity.consent.not_in_force');
  });

  it('answers 400 for a purpose the platform does not have', async () => {
    const { registry, consents } = aPatient('health_data');
    app = await bootAppWith(registry, { consents });

    await request(app.getHttpServer())
      .post('/v1/me/consents/whatever/revoke')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(400);
  });

  it('answers 403 for a professional', async () => {
    const registry = new InMemoryIdentityRegistry({ [TEST_USER_ID]: professionalIdentity() });
    app = await bootAppWith(registry, { consents: new InMemoryConsentRepository('unused') });

    await request(app.getHttpServer())
      .post('/v1/me/consents/health_data/revoke')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(403);
  });
});
