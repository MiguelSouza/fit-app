import { randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import {
  acceptedInvitationSchema,
  createdInvitationSchema,
  invitationListSchema,
} from '@fit-app/contracts';
import request from 'supertest';

import {
  signAccessToken,
  TEST_USER_ID,
} from '../../../shared/auth/local-access-token.spec-support';
import { INVALID_REQUEST_CODE } from '../../../shared/presentation/schema-validation';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from '../application/in-memory-identity-registry.spec-support';
import { InMemoryInvitationAcceptanceRepository } from '../application/in-memory-invitation-acceptance.spec-support';
import {
  InMemoryInvitationRepository,
  invitationRow,
} from '../application/in-memory-invitation-repository.spec-support';
import {
  hashOfPredictableToken,
  PredictableInvitationTokenIssuer,
} from '../application/predictable-invitation-token.spec-support';
import { bootAppWith } from './identity-app.spec-support';

/**
 * `/v1/invitations` over the real `AppModule`: the three requests the
 * "Convites" screen of the panel makes, and the one the patient makes when
 * they open the link.
 *
 * What it covers is the HTTP half — the body validated against the contract,
 * the answer serialized as the contract, the status code of each refusal —
 * with the repository and the token issuer as the only seams. That the rows
 * land in the right practice is the integration test's job.
 */
const ORGANIZATION_ID = randomUUID();
const OTHER_ORGANIZATION_ID = randomUUID();

const BODY = { name: 'Ana', contact: '+55 11 90000-0000' };

function post(app: INestApplication, token: string, body: object) {
  return request(app.getHttpServer())
    .post('/v1/invitations')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function get(app: INestApplication, token: string) {
  return request(app.getHttpServer())
    .get('/v1/invitations')
    .set('Authorization', `Bearer ${token}`);
}

function revoke(app: INestApplication, token: string, invitationId: string) {
  return request(app.getHttpServer())
    .post(`/v1/invitations/${invitationId}/revoke`)
    .set('Authorization', `Bearer ${token}`);
}

function accept(app: INestApplication, token: string, body: object) {
  return request(app.getHttpServer())
    .post('/v1/invitations/accept')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

describe('the invitation routes', () => {
  let invitations: InMemoryInvitationRepository;
  let tokens: PredictableInvitationTokenIssuer;
  let app: INestApplication;
  let accessToken: string;

  beforeEach(async () => {
    invitations = new InMemoryInvitationRepository();
    tokens = new PredictableInvitationTokenIssuer();
    app = await bootAppWith(
      new InMemoryIdentityRegistry({ [TEST_USER_ID]: professionalIdentity(ORGANIZATION_ID) }),
      { invitations, tokens },
    );
    accessToken = await signAccessToken();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/invitations', () => {
    it('creates the invitation and answers the token once', async () => {
      const response = await post(app, accessToken, BODY).expect(201);

      expect(response.body).toEqual({
        invitation: {
          id: expect.any(String),
          status: 'pending',
          name: 'Ana',
          contact: '+55 11 90000-0000',
          createdAt: expect.any(String),
          expiresAt: expect.any(String),
        },
        token: tokens.tokens[0],
      });

      expect(createdInvitationSchema.safeParse(response.body).success).toBe(true);
    });

    it('answers dates in UTC, as the contract declares them', async () => {
      const response = await post(app, accessToken, BODY).expect(201);

      const { createdAt, expiresAt } = response.body.invitation as {
        createdAt: string;
        expiresAt: string;
      };

      expect(createdAt).toMatch(/Z$/u);
      expect(Date.parse(expiresAt) - Date.parse(createdAt)).toBe(14 * 24 * 60 * 60 * 1000);
    });

    it('creates one with no name and no contact', async () => {
      const response = await post(app, accessToken, {}).expect(201);

      expect(response.body.invitation).not.toHaveProperty('name');
      expect(response.body.invitation).not.toHaveProperty('contact');
    });

    it('never answers the hash of the token, nor any other field of the row', async () => {
      const response = await post(app, accessToken, BODY).expect(201);

      // The serializer drops what the contract does not declare, which is the
      // cheap half of "a resposta carrega id e código": no `tokenHash`, no
      // `organizationId`, no `invitedByProfileId`.
      expect(JSON.stringify(response.body)).not.toContain('ash');
      expect(response.body.invitation).not.toHaveProperty('organizationId');
    });

    it('refuses a body the contract does not accept, naming the field', async () => {
      const response = await post(app, accessToken, { name: 'A' }).expect(400);

      expect(response.body.error.code).toBe(INVALID_REQUEST_CODE);
      expect(response.body.error.message).toContain('name');
    });

    it('ignores an organization somebody tries to send in the body', async () => {
      await post(app, accessToken, { ...BODY, organizationId: OTHER_ORGANIZATION_ID }).expect(201);

      // The extra key is dropped by the validation pipe, and the invitation
      // went to the practice of whoever called.
      await expect(invitations.listByOrganization(ORGANIZATION_ID)).resolves.toHaveLength(1);
      await expect(invitations.listByOrganization(OTHER_ORGANIZATION_ID)).resolves.toEqual([]);
    });

    it('answers 403 when the account is a patient', async () => {
      await app.close();
      app = await bootAppWith(new InMemoryIdentityRegistry({ [TEST_USER_ID]: patientIdentity() }), {
        invitations,
        tokens,
      });

      const response = await post(app, accessToken, BODY).expect(403);

      expect(response.body.error.code).toBe('identity.professional.required');
    });

    it('answers 404 when the caller never finished the first access', async () => {
      await app.close();
      app = await bootAppWith(new InMemoryIdentityRegistry(), { invitations, tokens });

      const response = await post(app, accessToken, BODY).expect(404);

      expect(response.body.error.code).toBe('identity.profile.not_found');
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).post('/v1/invitations').send(BODY).expect(401);
    });
  });

  describe('GET /v1/invitations', () => {
    it('answers the practice invitations with the status of each', async () => {
      const pending = invitationRow(ORGANIZATION_ID, {
        createdAt: new Date('2026-03-08T10:00:00Z'),
      });
      const expired = invitationRow(ORGANIZATION_ID, {
        createdAt: new Date('2026-01-01T10:00:00Z'),
        expiresAt: new Date('2026-01-15T10:00:00Z'),
      });
      const revoked = invitationRow(ORGANIZATION_ID, {
        createdAt: new Date('2026-02-01T10:00:00Z'),
        revokedAt: new Date('2026-02-02T10:00:00Z'),
      });

      await app.close();
      app = await bootAppWith(
        new InMemoryIdentityRegistry({ [TEST_USER_ID]: professionalIdentity(ORGANIZATION_ID) }),
        { invitations: new InMemoryInvitationRepository([expired, revoked, pending]), tokens },
      );

      const response = await get(app, accessToken).expect(200);

      expect(response.body.invitations).toEqual([
        expect.objectContaining({ id: pending.id, status: 'pending' }),
        expect.objectContaining({ id: revoked.id, status: 'revoked' }),
        expect.objectContaining({ id: expired.id, status: 'expired' }),
      ]);

      expect(invitationListSchema.safeParse(response.body).success).toBe(true);
    });

    it('answers an empty list for a practice that never invited anybody', async () => {
      const response = await get(app, accessToken).expect(200);

      expect(response.body).toEqual({ invitations: [] });
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).get('/v1/invitations').expect(401);
    });
  });

  describe('POST /v1/invitations/:id/revoke', () => {
    it('revokes a pending invitation of the practice', async () => {
      const created = await post(app, accessToken, BODY).expect(201);
      const invitationId = (created.body.invitation as { id: string }).id;

      const response = await revoke(app, accessToken, invitationId).expect(200);

      expect(response.body).toMatchObject({
        id: invitationId,
        status: 'revoked',
        revokedAt: expect.any(String),
      });
    });

    it('answers 409 when it is no longer pending', async () => {
      const created = await post(app, accessToken, BODY).expect(201);
      const invitationId = (created.body.invitation as { id: string }).id;

      await revoke(app, accessToken, invitationId).expect(200);

      const response = await revoke(app, accessToken, invitationId).expect(409);

      expect(response.body.error.code).toBe('identity.invitation.not_pending');
    });

    it('answers 404 for an invitation of another practice', async () => {
      const theirs = invitationRow(OTHER_ORGANIZATION_ID);

      await app.close();
      app = await bootAppWith(
        new InMemoryIdentityRegistry({ [TEST_USER_ID]: professionalIdentity(ORGANIZATION_ID) }),
        { invitations: new InMemoryInvitationRepository([theirs]), tokens },
      );

      const response = await revoke(app, accessToken, theirs.id).expect(404);

      expect(response.body.error.code).toBe('identity.invitation.not_found');
    });

    it('refuses an id that is not a uuid, before any use case runs', async () => {
      const response = await revoke(app, accessToken, 'not-a-uuid').expect(400);

      expect(response.body.error.code).toBe(INVALID_REQUEST_CODE);
    });

    it('answers 401 without a token', async () => {
      await request(app.getHttpServer()).post(`/v1/invitations/${randomUUID()}/revoke`).expect(401);
    });
  });

  describe('POST /v1/invitations/accept', () => {
    /**
     * The link a patient opens, behind a token this suite knows. As long as a
     * real one, which is 43 characters of `base64url`: the contract refuses a
     * token of another length before any use case runs.
     */
    const LINK_TOKEN = 'the-token-of-the-link-the-patient-opened-00';

    const ACCEPTANCE = {
      token: LINK_TOKEN,
      fullName: 'Paciente de teste',
      consents: ['health_data', 'share_with_professional'],
    };

    let acceptances: InMemoryInvitationAcceptanceRepository;

    beforeEach(async () => {
      // Another app: whoever accepts an invitation has no profile yet, so the
      // registry of this half is empty, and the acceptance repository is the
      // seam instead of the invitation one.
      await app.close();

      acceptances = new InMemoryInvitationAcceptanceRepository();
      acceptances.seed(invitationRow(ORGANIZATION_ID), hashOfPredictableToken(LINK_TOKEN));

      app = await bootAppWith(new InMemoryIdentityRegistry(), { acceptances, tokens });
    });

    it('makes the caller a patient of the practice and answers 201', async () => {
      const response = await accept(app, accessToken, ACCEPTANCE).expect(201);

      expect(response.body).toEqual({
        profileId: expect.any(String),
        organizationId: ORGANIZATION_ID,
        careRelationshipId: expect.any(String),
        acceptedAt: expect.any(String),
        consents: ['health_data', 'share_with_professional'],
      });

      expect(acceptedInvitationSchema.safeParse(response.body).success).toBe(true);
      expect(response.body.acceptedAt as string).toMatch(/Z$/u);
    });

    it('answers no personal data: not the name, not the token', async () => {
      const response = await accept(app, accessToken, ACCEPTANCE).expect(201);

      expect(JSON.stringify(response.body)).not.toContain('Paciente de teste');
      expect(JSON.stringify(response.body)).not.toContain(LINK_TOKEN);
    });

    it('records the optional consents the patient ticked', async () => {
      const response = await accept(app, accessToken, {
        ...ACCEPTANCE,
        consents: [...ACCEPTANCE.consents, 'ai_processing'],
      }).expect(201);

      expect(response.body.consents).toEqual([
        'health_data',
        'share_with_professional',
        'ai_processing',
      ]);
    });

    it('answers 422 without a required consent, and leaves the link usable', async () => {
      const response = await accept(app, accessToken, {
        ...ACCEPTANCE,
        consents: ['wearable_data'],
      }).expect(422);

      expect(response.body.error.code).toBe('identity.consent.required_missing');

      await accept(app, accessToken, ACCEPTANCE).expect(201);
    });

    it('answers 404 for a token that opens no invitation', async () => {
      const response = await accept(app, accessToken, {
        ...ACCEPTANCE,
        token: 'a-token-that-opens-no-invitation-at-all',
      }).expect(404);

      expect(response.body.error.code).toBe('identity.invitation.not_found');
    });

    it('answers 409 the second time the same link is used', async () => {
      await accept(app, accessToken, ACCEPTANCE).expect(201);

      const response = await accept(app, accessToken, ACCEPTANCE).expect(409);

      expect(response.body.error.code).toBe('identity.invitation.already_accepted');
    });

    it('answers 409 when the account is a professional', async () => {
      await app.close();
      app = await bootAppWith(
        new InMemoryIdentityRegistry({ [TEST_USER_ID]: professionalIdentity(ORGANIZATION_ID) }),
        { acceptances, tokens },
      );

      const response = await accept(app, accessToken, ACCEPTANCE).expect(409);

      expect(response.body.error.code).toBe('identity.profile.not_patient');
    });

    it('refuses a consent the contract does not know, before any use case runs', async () => {
      const response = await accept(app, accessToken, {
        ...ACCEPTANCE,
        consents: ['whatever'],
      }).expect(400);

      expect(response.body.error.code).toBe(INVALID_REQUEST_CODE);
    });

    it('refuses a body with no name', async () => {
      const response = await accept(app, accessToken, {
        token: LINK_TOKEN,
        consents: ACCEPTANCE.consents,
      }).expect(400);

      expect(response.body.error.code).toBe(INVALID_REQUEST_CODE);
      expect(response.body.error.message).toContain('fullName');
    });

    it('answers 401 without a token of its own: the link is not an authentication', async () => {
      await request(app.getHttpServer())
        .post('/v1/invitations/accept')
        .send(ACCEPTANCE)
        .expect(401);
    });
  });
});
