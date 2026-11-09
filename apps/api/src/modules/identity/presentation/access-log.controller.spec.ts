import { randomUUID } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { accessLogPageSchema } from '@fit-app/contracts';
import request from 'supertest';

import {
  signAccessToken,
  TEST_USER_ID,
} from '../../../shared/auth/local-access-token.spec-support';
import { InMemoryAccessLogRepository } from '../application/in-memory-access-log.spec-support';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from '../application/in-memory-identity-registry.spec-support';
import { accessToLog } from '../domain/access-log';
import { bootAppWith } from './identity-app.spec-support';

/**
 * `GET /v1/me/access-log` over the real `AppModule`, with the identity
 * registry and the access log as the only seams
 * (`identity-app.spec-support.ts`).
 *
 * What this suite is about is the HTTP surface of "quem viu meus dados": the
 * body as the contract declares it, the paging, and who is refused. The
 * card's second acceptance criterion — "paciente vê só os próprios registros"
 * — is the test with two patients in it, and it holds for a structural
 * reason: the route has no patient id in it at all.
 *
 * The route is not `@Public()`, so the global guard answers 401 without a
 * token (ADR 0007). No data of a real person: the ids are random and the
 * names are labels.
 */
const PROFESSIONAL_PROFILE_ID = randomUUID();

const ACTOR = { name: 'Ana Souza', professionalType: 'nutritionist' } as const;

function aPatientWithAccessesAt(...instants: readonly string[]) {
  const patient = patientIdentity();
  const registry = new InMemoryIdentityRegistry({ [TEST_USER_ID]: patient });
  const accessLog = new InMemoryAccessLogRepository({ [PROFESSIONAL_PROFILE_ID]: ACTOR });

  for (const instant of instants) {
    void accessLog.append(
      accessToLog(
        PROFESSIONAL_PROFILE_ID,
        patient.personId,
        'patient_chart',
        'view',
        new Date(instant),
      ),
    );
  }

  return { patient, registry, accessLog };
}

function getAccessLog(app: INestApplication, query = '') {
  return request(app.getHttpServer()).get(`/v1/me/access-log${query}`);
}

describe('GET /v1/me/access-log', () => {
  let app: INestApplication;
  let token: string;

  beforeEach(async () => {
    token = await signAccessToken();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers who accessed, what and when, newest first', async () => {
    const { registry, accessLog } = aPatientWithAccessesAt(
      '2026-11-08T12:00:00.000Z',
      '2026-11-09T12:00:00.000Z',
    );
    app = await bootAppWith(registry, { accessLog });

    const response = await getAccessLog(app).set('Authorization', `Bearer ${token}`).expect(200);

    expect(response.body).toEqual({
      entries: [
        {
          actor: { name: 'Ana Souza', professionalType: 'nutritionist' },
          resource: 'patient_chart',
          action: 'view',
          occurredAt: '2026-11-09T12:00:00.000Z',
        },
        {
          actor: { name: 'Ana Souza', professionalType: 'nutritionist' },
          resource: 'patient_chart',
          action: 'view',
          occurredAt: '2026-11-08T12:00:00.000Z',
        },
      ],
    });

    // What the app will do with it: read it as the contract.
    expect(accessLogPageSchema.safeParse(response.body).success).toBe(true);
  });

  it('answers an empty page for a patient nobody has opened', async () => {
    const { registry, accessLog } = aPatientWithAccessesAt();
    app = await bootAppWith(registry, { accessLog });

    const response = await getAccessLog(app).set('Authorization', `Bearer ${token}`).expect(200);

    expect(response.body).toEqual({ entries: [] });
  });

  it('answers only the records of whoever is calling', async () => {
    // The acceptance criterion. The other patient's record is in the same
    // table, written by the same professional, and there is no way to ask for
    // it: the route carries no patient id.
    const { registry, accessLog, patient } = aPatientWithAccessesAt('2026-11-09T12:00:00.000Z');

    await accessLog.append(
      accessToLog(
        PROFESSIONAL_PROFILE_ID,
        randomUUID(),
        'patient_chart',
        'export',
        new Date('2026-11-09T13:00:00.000Z'),
      ),
    );

    app = await bootAppWith(registry, { accessLog });

    const response = await getAccessLog(app).set('Authorization', `Bearer ${token}`).expect(200);

    expect(accessLog.rows).toHaveLength(2);
    expect(accessLog.countFor(patient.personId)).toBe(1);
    expect(response.body.entries).toHaveLength(1);
    expect(response.body.entries[0].action).toBe('view');
  });

  it('pages with the cursor it answered, and says when there is no next page', async () => {
    const { registry, accessLog } = aPatientWithAccessesAt(
      '2026-11-07T12:00:00.000Z',
      '2026-11-08T12:00:00.000Z',
      '2026-11-09T12:00:00.000Z',
    );
    app = await bootAppWith(registry, { accessLog });

    const first = await getAccessLog(app, '?limit=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(first.body.entries).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));

    const second = await getAccessLog(app, `?limit=2&cursor=${first.body.nextCursor}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(second.body.entries).toHaveLength(1);
    expect(second.body.entries[0].occurredAt).toBe('2026-11-07T12:00:00.000Z');
    expect(second.body.nextCursor).toBeUndefined();
  });

  it('refuses a limit outside the bounds, before anything is read', async () => {
    const { registry, accessLog } = aPatientWithAccessesAt('2026-11-09T12:00:00.000Z');
    app = await bootAppWith(registry, { accessLog });

    const response = await getAccessLog(app, '?limit=0')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body.error.code).toBe('api.request.invalid');
  });

  it('refuses a cursor this API did not mint, instead of answering an empty page', async () => {
    const { registry, accessLog } = aPatientWithAccessesAt('2026-11-09T12:00:00.000Z');
    app = await bootAppWith(registry, { accessLog });

    const response = await getAccessLog(app, '?cursor=nao-foi-esta-api')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body.error.code).toBe('identity.access_log.invalid_cursor');
  });

  it('answers 403 to a professional: the log is the patient own', async () => {
    const registry = new InMemoryIdentityRegistry({ [TEST_USER_ID]: professionalIdentity() });
    app = await bootAppWith(registry, { accessLog: new InMemoryAccessLogRepository() });

    const response = await getAccessLog(app).set('Authorization', `Bearer ${token}`).expect(403);

    expect(response.body.error.code).toBe('identity.patient.required');
  });

  it('answers 404 to somebody who never finished the first access', async () => {
    app = await bootAppWith(new InMemoryIdentityRegistry(), {
      accessLog: new InMemoryAccessLogRepository(),
    });

    const response = await getAccessLog(app).set('Authorization', `Bearer ${token}`).expect(404);

    expect(response.body.error.code).toBe('identity.profile.not_found');
  });

  it('answers 401 without a token', async () => {
    const { registry, accessLog } = aPatientWithAccessesAt('2026-11-09T12:00:00.000Z');
    app = await bootAppWith(registry, { accessLog });

    await getAccessLog(app).expect(401);
  });
});
