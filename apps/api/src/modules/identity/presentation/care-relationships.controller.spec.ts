import { randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { endedCareRelationshipSchema } from '@fit-app/contracts';
import request from 'supertest';

import {
  signAccessToken,
  TEST_USER_ID,
} from '../../../shared/auth/local-access-token.spec-support';
import { InMemoryCareRelationshipRepository } from '../application/in-memory-care-relationship.spec-support';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from '../application/in-memory-identity-registry.spec-support';
import { type RegisteredIdentity } from '../domain/registered-identity';
import { bootAppWith } from './identity-app.spec-support';

/**
 * The two routes that end a follow-up, over the real `AppModule`, with the
 * identity registry and the care links as the only seams
 * (`identity-app.spec-support.ts`).
 *
 * What this suite is about is the HTTP surface of card I-07: the body as the
 * contract declares it, the status codes each refusal maps to, and the one
 * thing the panel and the app key their screens off — that a patient of another
 * practice is a **404** and never a 403 (ADR 0017).
 *
 * Neither route is `@Public()`, so the global guard answers 401 without a token
 * (ADR 0007). No data of a real person: the ids are random and the names are
 * labels.
 */
interface Scene {
  readonly patientProfileId: string;
  readonly careRelationshipId: string;
  readonly registry: InMemoryIdentityRegistry;
  readonly careRelationships: InMemoryCareRelationshipRepository;
}

/** The one practice a professional belongs to (ADR 0014). */
function practiceOf(identity: RegisteredIdentity): string {
  const [membership] = identity.organizations;

  if (membership === undefined) throw new Error('the double built a professional with no practice');

  return membership.organizationId;
}

/**
 * A practice following a patient, with whichever of the two is the caller
 * signed in as `TEST_USER_ID` — which is the subject of the token every test
 * here sends.
 */
function aFollowedPatient(options: {
  readonly callerIs: 'professional' | 'patient';
  readonly endedAt?: Date;
}): Scene {
  const professional = professionalIdentity();
  const patient = patientIdentity();
  const caller = options.callerIs === 'professional' ? professional : patient;

  const careRelationships = new InMemoryCareRelationshipRepository();
  const organizationId = practiceOf(professional);

  careRelationships.addProfessional({ profileId: professional.personId, organizationId });

  const link = careRelationships.addCareRelationship(
    organizationId,
    patient.personId,
    options.endedAt ?? null,
  );

  return {
    patientProfileId: patient.personId,
    careRelationshipId: link.id,
    registry: new InMemoryIdentityRegistry({ [TEST_USER_ID]: caller }),
    careRelationships,
  };
}

function endAsProfessional(app: INestApplication, patientId: string) {
  return request(app.getHttpServer()).post(`/v1/patients/${patientId}/care-relationship/end`);
}

function endAsPatient(app: INestApplication, careRelationshipId: string) {
  return request(app.getHttpServer()).post(`/v1/me/care-relationships/${careRelationshipId}/end`);
}

describe('POST /v1/patients/{patientId}/care-relationship/end', () => {
  let app: INestApplication;
  let token: string;

  beforeEach(async () => {
    token = await signAccessToken();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers the ended link, with both dates and the status', async () => {
    const scene = aFollowedPatient({ callerIs: 'professional' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsProfessional(app, scene.patientProfileId)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual({
      id: scene.careRelationshipId,
      organizationId: scene.careRelationships.rows[0]?.organizationId,
      status: 'ended',
      startedAt: '2026-10-01T12:00:00.000Z',
      endedAt: expect.any(String),
    });

    // What the panel will do with it: read it as the contract.
    expect(endedCareRelationshipSchema.safeParse(response.body).success).toBe(true);

    // And nothing was removed: the row is there, dated.
    expect(scene.careRelationships.rows).toHaveLength(1);
    expect(scene.careRelationships.rows[0]?.endedAt).toBeInstanceOf(Date);
  });

  it('answers 404 for a patient of another practice, as for one that does not exist', async () => {
    const scene = aFollowedPatient({ callerIs: 'professional' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const stranger = await endAsProfessional(app, randomUUID())
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(stranger.body.error.code).toBe('identity.patient.not_found');
  });

  it('answers 409 to the second ending', async () => {
    const scene = aFollowedPatient({
      callerIs: 'professional',
      endedAt: new Date('2026-11-01T12:00:00.000Z'),
    });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsProfessional(app, scene.patientProfileId)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(response.body.error.code).toBe('identity.care_relationship.already_ended');
  });

  it('answers 400 to an id that cannot be a patient, before anything is read', async () => {
    const scene = aFollowedPatient({ callerIs: 'professional' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsProfessional(app, 'nao-e-um-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body.error.code).toBe('api.request.invalid');
  });

  it('answers 403 to a patient: this side is the practice own', async () => {
    const scene = aFollowedPatient({ callerIs: 'patient' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsProfessional(app, scene.patientProfileId)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.error.code).toBe('identity.professional.required');
  });

  it('answers 404 to somebody who never finished the first access', async () => {
    const scene = aFollowedPatient({ callerIs: 'professional' });
    app = await bootAppWith(new InMemoryIdentityRegistry(), {
      careRelationships: scene.careRelationships,
    });

    const response = await endAsProfessional(app, scene.patientProfileId)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body.error.code).toBe('identity.profile.not_found');
  });

  it('answers 401 without a token', async () => {
    const scene = aFollowedPatient({ callerIs: 'professional' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    await endAsProfessional(app, scene.patientProfileId).expect(401);
    expect(scene.careRelationships.rows[0]?.endedAt).toBeNull();
  });
});

describe('POST /v1/me/care-relationships/{careRelationshipId}/end', () => {
  let app: INestApplication;
  let token: string;

  beforeEach(async () => {
    token = await signAccessToken();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers the ended link to the patient who ended it', async () => {
    const scene = aFollowedPatient({ callerIs: 'patient' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsPatient(app, scene.careRelationshipId)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({ id: scene.careRelationshipId, status: 'ended' });
    expect(endedCareRelationshipSchema.safeParse(response.body).success).toBe(true);
    expect(scene.careRelationships.rows).toHaveLength(1);
  });

  it('answers 404 for a link that is another patient own', async () => {
    const scene = aFollowedPatient({ callerIs: 'patient' });
    const somebodyElse = scene.careRelationships.addCareRelationship(randomUUID(), randomUUID());
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsPatient(app, somebodyElse.id)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(response.body.error.code).toBe('identity.care_relationship.not_found');
    expect(scene.careRelationships.rows[1]?.endedAt).toBeNull();
  });

  it('answers 409 to the second ending', async () => {
    const scene = aFollowedPatient({
      callerIs: 'patient',
      endedAt: new Date('2026-11-01T12:00:00.000Z'),
    });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsPatient(app, scene.careRelationshipId)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(response.body.error.code).toBe('identity.care_relationship.already_ended');
  });

  it('answers 400 to an id that cannot be a link', async () => {
    const scene = aFollowedPatient({ callerIs: 'patient' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsPatient(app, 'nao-e-um-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body.error.code).toBe('api.request.invalid');
  });

  it('answers 403 to a professional: nobody ends a link on somebody else behalf', async () => {
    const scene = aFollowedPatient({ callerIs: 'professional' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    const response = await endAsPatient(app, scene.careRelationshipId)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(response.body.error.code).toBe('identity.patient.required');
  });

  it('answers 401 without a token', async () => {
    const scene = aFollowedPatient({ callerIs: 'patient' });
    app = await bootAppWith(scene.registry, { careRelationships: scene.careRelationships });

    await endAsPatient(app, scene.careRelationshipId).expect(401);
    expect(scene.careRelationships.rows[0]?.endedAt).toBeNull();
  });
});
