import { type INestApplication } from '@nestjs/common';
import { meResponseSchema } from '@fit-app/contracts';
import request from 'supertest';

import {
  signAccessToken,
  TEST_USER_ID,
} from '../../../shared/auth/local-access-token.spec-support';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
} from '../application/in-memory-identity-registry.spec-support';
import { RegisterProfessionalUseCase } from '../application/register-professional.use-case';
import { bootAppWith } from './identity-app.spec-support';

/**
 * `GET /v1/me` over the real `AppModule`, with the identity registry as the
 * only seam (`identity-app.spec-support.ts`).
 *
 * The route is not `@Public()`: the global guard of card F-08 answers 401
 * without a token, so the test signs one with the same secret it puts in the
 * environment — and with the `sub` the registry was seeded for, which is how
 * it proves the answer is about the caller and not about whoever is first in
 * the table.
 */
const INPUT = {
  fullName: 'Ana Souza',
  councilNumber: 'CRN-3 12345',
  specialty: 'Nutrição esportiva',
  professionalType: null,
};

describe('GET /v1/me', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('answers the profile, the professional type and the organizations', async () => {
    const registry = new InMemoryIdentityRegistry();
    const registered = await new RegisterProfessionalUseCase(registry).execute(TEST_USER_ID, INPUT);
    app = await bootAppWith(registry);

    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    expect(response.body).toEqual({
      personId: registered.personId,
      role: 'professional',
      timeZone: 'America/Sao_Paulo',
      professional: {
        type: 'nutritionist',
        councilNumber: 'CRN-3 12345',
        specialty: 'Nutrição esportiva',
        organizations: [
          {
            organizationId: registered.organizations[0]?.organizationId,
            name: 'Ana Souza',
            kind: 'solo',
            role: 'owner',
          },
        ],
      },
    });

    // What the panel and the app will do with it: read it as the contract.
    expect(meResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('leaves the professional half out for a patient', async () => {
    const registry = new InMemoryIdentityRegistry({ [TEST_USER_ID]: patientIdentity() });
    app = await bootAppWith(registry);

    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    expect(response.body).toMatchObject({ role: 'patient' });
    expect(response.body).not.toHaveProperty('professional');
  });

  it('never answers the name of whoever is calling', async () => {
    const registry = new InMemoryIdentityRegistry();
    await new RegisterProfessionalUseCase(registry).execute(TEST_USER_ID, INPUT);
    app = await bootAppWith(registry);

    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(200);

    // The profile carries a `fullName` and the response does not: the only
    // free text here is the name of the caller's own practice (CLAUDE.md,
    // "Saúde e LGPD"). The serializer drops whatever the schema does not
    // declare, and this is the test that notices if the schema ever declares
    // it.
    expect(response.body).not.toHaveProperty('fullName');
  });

  it('answers 404 for whoever signed in and never finished the first access', async () => {
    app = await bootAppWith(new InMemoryIdentityRegistry());

    const response = await request(app.getHttpServer())
      .get('/v1/me')
      .set('Authorization', `Bearer ${await signAccessToken()}`)
      .expect(404);

    // The code, not the text, is what the panel keys off to open the first
    // access screen.
    expect(response.body.error.code).toBe('identity.profile.not_found');
  });

  it('answers 401 without a token, like every route that is not public', async () => {
    app = await bootAppWith(new InMemoryIdentityRegistry());

    await request(app.getHttpServer()).get('/v1/me').expect(401);
  });
});
