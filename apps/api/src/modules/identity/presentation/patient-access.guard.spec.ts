import { randomUUID } from 'node:crypto';

import {
  Controller,
  Get,
  Module,
  Param,
  type INestApplication,
  type LoggerService,
} from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApp } from '../../../bootstrap';
import { AuthModule } from '../../../shared/auth/auth.module';
import {
  signAccessToken,
  TEST_USER_ID,
} from '../../../shared/auth/local-access-token.spec-support';
import { EnvModule, ENV } from '../../../shared/config/env.module';
import { GlobalExceptionFilter } from '../../../shared/presentation/global-exception.filter';
import { IdentityModule } from '../identity.module';
import {
  InMemoryIdentityRegistry,
  patientIdentity,
  professionalIdentity,
} from '../application/in-memory-identity-registry.spec-support';
import { InMemoryPatientAccessRepository } from '../application/in-memory-patient-access.spec-support';
import { IDENTITY_REGISTRY } from '../application/ports/identity-registry.port';
import { PATIENT_ACCESS_REPOSITORY } from '../application/ports/patient-access.port';
import { type RegisteredIdentity } from '../domain/registered-identity';
import { env } from './identity-app.spec-support';
import { RequiresPatientAccess } from './requires-patient-access.decorator';

/**
 * `@RequiresPatientAccess()` over HTTP: what a route with a patient in its
 * path answers to a professional who may see them and to every professional
 * who may not.
 *
 * The acceptance criterion this suite exists for is the status code: **404 on
 * every refusal**, so that a professional trying ids cannot tell a patient
 * they are not allowed to see from a patient who is not there. A 403 anywhere
 * below would be a list of the platform's patients, one request at a time.
 *
 * No module has a patient route yet — `nutrition`, `health` and `insights` are
 * still skeletons — so the route is declared here, in the test, over the real
 * `IdentityModule`, the real global auth guard, the real validation pipe and
 * the real error filter. That is the whole point: what is proved is the
 * wiring a `nutrition` controller will get by writing one line.
 */
const ORGANIZATION_ID = randomUUID();

/**
 * A chart endpoint, as another module will write one. The handler is reached
 * only when the guard let the request through, so what it answers is the proof
 * that it was.
 */
@Controller({ path: 'patients' })
class PatientChartController {
  @Get(':patientId/chart')
  @RequiresPatientAccess()
  chart(@Param('patientId') patientId: string): { patientId: string } {
    return { patientId };
  }

  /** The decorator naming another parameter, which a route is free to do. */
  @Get('summaries/:id')
  @RequiresPatientAccess('id')
  summary(@Param('id') patientId: string): { patientId: string } {
    return { patientId };
  }

  /** The decorator on a route with no patient in it: a wiring mistake, and a 500. */
  @Get('mine')
  @RequiresPatientAccess()
  mine(): { patientId: string } {
    return { patientId: 'unreachable' };
  }
}

/**
 * The smallest app a patient route lives in: the identity module, the global
 * authentication guard and the error filter that turns a domain error into a
 * status code. `IdentityModule` is imported as a whole — the guard comes out of
 * its `exports`, which is what a real module does too (CLAUDE.md rule 1).
 */
@Module({
  imports: [EnvModule, AuthModule, IdentityModule],
  controllers: [PatientChartController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class ChartTestModule {}

/**
 * The refusals below are warnings on purpose, and the deliberate 500 is an
 * error the filter logs: both are silenced so the output of the suite stays
 * readable. `setLogger` and not a mock — these tests run as ES modules, where
 * the `jest` object is not a global, and Nest's own seam does the job without
 * one.
 */
const SILENT: LoggerService = {
  log: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
};

describe('the patient access guard', () => {
  let facts: InMemoryPatientAccessRepository;
  let app: INestApplication;
  let accessToken: string;
  let professional: RegisteredIdentity;

  async function boot(identity: RegisteredIdentity): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [ChartTestModule] })
      .setLogger(SILENT)
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(IDENTITY_REGISTRY)
      .useValue(new InMemoryIdentityRegistry({ [TEST_USER_ID]: identity }))
      .overrideProvider(PATIENT_ACCESS_REPOSITORY)
      .useValue(facts)
      .compile();

    const booted = moduleRef.createNestApplication();
    configureApp(booted, env);

    return booted.init();
  }

  function chart(patientId: string) {
    return request(app.getHttpServer())
      .get(`/v1/patients/${patientId}/chart`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  beforeEach(async () => {
    facts = new InMemoryPatientAccessRepository();
    professional = professionalIdentity(ORGANIZATION_ID);

    // The professional of the token, known to both fakes by the same profile
    // id: the registry answers who is calling, and the facts answer what they
    // may see.
    facts.addProfessional({ profileId: professional.personId, organizationId: ORGANIZATION_ID });

    app = await boot(professional);
    accessToken = await signAccessToken();
  });

  afterEach(async () => {
    await app.close();
  });

  /** A patient of this professional's practice, with the sharing consent. */
  function aFollowedPatient(): string {
    const patientId = randomUUID();

    facts.addCareRelationship(ORGANIZATION_ID, patientId);
    facts.grant(patientId);

    return patientId;
  }

  it('lets the request through with an active link and the consent in force', async () => {
    const patientId = aFollowedPatient();

    const response = await chart(patientId);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ patientId });
  });

  it('answers 404 to a patient of another practice', async () => {
    const stranger = randomUUID();

    facts.addCareRelationship(randomUUID(), stranger);
    facts.grant(stranger);

    const response = await chart(stranger);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'identity.patient.not_found', message: 'Paciente não encontrado.' },
    });
  });

  it('answers 404 once the link ends, and the same body', async () => {
    const patientId = randomUUID();

    facts.addCareRelationship(ORGANIZATION_ID, patientId, new Date('2026-11-01T12:00:00Z'));
    facts.grant(patientId);

    const response = await chart(patientId);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('identity.patient.not_found');
  });

  it('answers 404 as soon as the consent is revoked', async () => {
    const patientId = aFollowedPatient();

    await expect(chart(patientId)).resolves.toMatchObject({ status: 200 });

    facts.revoke(patientId);

    await expect(chart(patientId)).resolves.toMatchObject({ status: 404 });
  });

  it('answers the same 404 for a patient that does not exist at all', async () => {
    // The criterion, in one assertion: a patient the caller may not see and a
    // patient nobody can see are indistinguishable from the outside.
    const unknown = await chart(randomUUID());
    const theirs = aFollowedPatient();

    facts.revoke(theirs);

    const refused = await chart(theirs);

    expect(unknown.status).toBe(refused.status);
    expect(unknown.body).toEqual(refused.body);
  });

  it('answers 404 to an id that is not a uuid, without touching the database', async () => {
    const response = await chart('not-a-uuid');

    expect(response.status).toBe(404);
    expect(facts.reads).toBe(0);
  });

  it('refuses a request with no token, before asking anything about the patient', async () => {
    const patientId = aFollowedPatient();

    const response = await request(app.getHttpServer()).get(`/v1/patients/${patientId}/chart`);

    expect(response.status).toBe(401);
    expect(facts.reads).toBe(0);
  });

  it('answers 403 to a patient calling a professional route', async () => {
    // Nothing about the patient in the path is revealed by this one: what it
    // says is that the *caller* is not a professional, which is about them.
    await app.close();
    app = await boot(patientIdentity());

    const response = await chart(aFollowedPatient());

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('identity.professional.required');
  });

  it('honours the parameter the decorator names', async () => {
    const patientId = aFollowedPatient();

    const response = await request(app.getHttpServer())
      .get(`/v1/patients/summaries/${patientId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ patientId });
  });

  it('fails loudly on a route that has no patient parameter', async () => {
    // A 500 and not a 404: a route decorated by mistake is a bug in our code,
    // and a silent "não encontrado" is how it would go unnoticed for months.
    const response = await request(app.getHttpServer())
      .get('/v1/patients/mine')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('api.internal_error');
  });
});
