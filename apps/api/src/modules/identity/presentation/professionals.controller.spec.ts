import { type INestApplication } from '@nestjs/common';
import { meResponseSchema } from '@fit-app/contracts';
import request from 'supertest';

import { INVALID_REQUEST_CODE } from '../../../shared/presentation/schema-validation';
import {
  signAccessToken,
  TEST_USER_ID,
} from '../../../shared/auth/local-access-token.spec-support';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
} from '../application/in-memory-identity-registry.spec-support';
import { bootAppWith } from './identity-app.spec-support';

/**
 * `POST /v1/professionals/me` over the real `AppModule`: the request the first
 * access screen of the panel sends.
 *
 * What it covers here is the HTTP half — the body validated against the
 * contract, the answer serialized as the contract, the status code of each
 * refusal — with the registry as the only seam. That the four rows land
 * together is the integration test's job.
 */
const BODY = {
  fullName: 'Ana Souza',
  councilNumber: 'CRN-3 12345',
  specialty: 'Nutrição esportiva',
};

/**
 * The request, with the session already in the header. Not async on purpose:
 * what it answers is supertest's own chainable, so a test reads
 * `post(...).expect(200)` the way the suites of the other routes do.
 */
function post(app: INestApplication, token: string, body: object) {
  return request(app.getHttpServer())
    .post('/v1/professionals/me')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

describe('POST /v1/professionals/me', () => {
  let registry: InMemoryIdentityRegistry;
  let app: INestApplication;
  let token: string;

  beforeEach(async () => {
    registry = new InMemoryIdentityRegistry();
    app = await bootAppWith(registry);
    token = await signAccessToken();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers a nutritionist with a solo practice they own', async () => {
    const response = await post(app, token, BODY).expect(200);

    expect(response.body).toEqual({
      personId: expect.any(String),
      role: 'professional',
      timeZone: 'America/Sao_Paulo',
      professional: {
        type: 'nutritionist',
        councilNumber: 'CRN-3 12345',
        specialty: 'Nutrição esportiva',
        organizations: [
          {
            organizationId: expect.any(String),
            name: 'Ana Souza',
            kind: 'solo',
            role: 'owner',
          },
        ],
      },
    });

    expect(meResponseSchema.safeParse(response.body).success).toBe(true);
  });

  it('registers once however many times the panel sends it', async () => {
    const first = await post(app, token, BODY).expect(200);
    const second = await post(app, token, BODY).expect(200);

    expect(registry.registrations).toBe(1);
    expect(second.body).toEqual(first.body);
  });

  it('takes the person from the token, not from the body', async () => {
    // A body that tries to name somebody else: the extra keys are dropped by
    // the validation pipe, and the registration is the caller's.
    await post(app, token, {
      ...BODY,
      personId: 'someone-else',
      authUserId: 'someone-else',
    }).expect(200);

    await expect(registry.findByAuthUserId(TEST_USER_ID)).resolves.toMatchObject({
      role: 'professional',
    });
  });

  it('registers without a specialty, which is optional', async () => {
    const response = await post(app, token, {
      fullName: 'Ana Souza',
      councilNumber: 'CRN-3 12345',
    }).expect(200);

    expect(response.body.professional).not.toHaveProperty('specialty');
  });

  it('refuses a body the contract does not accept, naming the fields', async () => {
    const response = await post(app, token, { fullName: 'A', councilNumber: '' }).expect(400);

    expect(response.body.error.code).toBe(INVALID_REQUEST_CODE);
    expect(response.body.error.message).toContain('fullName');
    expect(response.body.error.message).toContain('councilNumber');
  });

  it('refuses a professional type the contract does not have', async () => {
    const response = await post(app, token, { ...BODY, professionalType: 'dentist' }).expect(400);

    expect(response.body.error.code).toBe(INVALID_REQUEST_CODE);
  });

  it('answers 409 when the account is already a patient', async () => {
    await app.close();
    app = await bootAppWith(new InMemoryIdentityRegistry({ [TEST_USER_ID]: patientIdentity() }));

    const response = await post(app, token, BODY).expect(409);

    expect(response.body.error.code).toBe('identity.profile.not_professional');
  });

  it('answers 401 without a token', async () => {
    await request(app.getHttpServer()).post('/v1/professionals/me').send(BODY).expect(401);
  });
});
