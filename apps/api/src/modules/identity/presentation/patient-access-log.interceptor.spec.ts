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
import { InMemoryAccessLogRepository } from '../application/in-memory-access-log.spec-support';
import {
  InMemoryIdentityRegistry,
  professionalIdentity,
} from '../application/in-memory-identity-registry.spec-support';
import { InMemoryPatientAccessRepository } from '../application/in-memory-patient-access.spec-support';
import { ACCESS_LOG_REPOSITORY } from '../application/ports/access-log.port';
import { IDENTITY_REGISTRY } from '../application/ports/identity-registry.port';
import { PATIENT_ACCESS_REPOSITORY } from '../application/ports/patient-access.port';
import { type RegisteredIdentity } from '../domain/registered-identity';
import { IdentityModule } from '../identity.module';
import { env } from './identity-app.spec-support';
import { RecordsPatientAccess } from './records-patient-access.decorator';
import { RequiresPatientAccess } from './requires-patient-access.decorator';

/**
 * `@RecordsPatientAccess()` over HTTP: the card's first acceptance criterion,
 * **"abrir a ficha gera exatamente um registro por visita"** (card I-06).
 *
 * No module has a chart route yet — `nutrition`, `health` and `insights` are
 * still skeletons — so the routes are declared here, in the test, over the
 * real `IdentityModule`, the real global auth guard and the real error filter,
 * exactly as `patient-access.guard.spec.ts` does. That is the point of it:
 * what is proved is the wiring a `nutrition` controller gets by writing two
 * lines, and the one record it leaves behind.
 *
 * The screen a professional opens is more than one request, and that is what
 * the second route below is for: only the one that *is* the visit records, so
 * the widgets that fill the ficha in do not each add a line to the patient's
 * list.
 */
const ORGANIZATION_ID = randomUUID();

@Controller({ path: 'patients' })
class PatientChartController {
  /** The visit: the route that opens the ficha, and the only one that records. */
  @Get(':patientId/chart')
  @RequiresPatientAccess()
  @RecordsPatientAccess('patient_chart', 'view')
  chart(@Param('patientId') patientId: string): { patientId: string } {
    return { patientId };
  }

  /** Part of the same screen, and not a visit of its own. */
  @Get(':patientId/chart/summary')
  @RequiresPatientAccess()
  summary(@Param('patientId') patientId: string): { patientId: string } {
    return { patientId };
  }

  /** Taking the data out of the platform, which is its own kind of access. */
  @Get(':patientId/chart/export')
  @RequiresPatientAccess()
  @RecordsPatientAccess('patient_chart', 'export')
  export(@Param('patientId') patientId: string): { patientId: string } {
    return { patientId };
  }

  /** A handler that breaks after the guard let it through. */
  @Get(':patientId/chart/broken')
  @RequiresPatientAccess()
  @RecordsPatientAccess('patient_chart', 'view')
  broken(): never {
    throw new Error('the handler broke');
  }

  /** The decorator on a route with no patient in it: a wiring mistake, and a 500. */
  @Get('mine')
  @RecordsPatientAccess('patient_chart', 'view')
  mine(): { patientId: string } {
    return { patientId: 'unreachable' };
  }
}

@Module({
  imports: [EnvModule, AuthModule, IdentityModule],
  controllers: [PatientChartController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class ChartTestModule {}

/** The refusals and the deliberate 500s are logged; the output stays readable. */
const SILENT: LoggerService = {
  log: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
};

describe('recording the opening of a chart', () => {
  let facts: InMemoryPatientAccessRepository;
  let records: InMemoryAccessLogRepository;
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
      .overrideProvider(ACCESS_LOG_REPOSITORY)
      .useValue(records)
      .compile();

    const booted = moduleRef.createNestApplication();
    configureApp(booted, env);

    return booted.init();
  }

  function get(path: string) {
    return request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${accessToken}`);
  }

  beforeEach(async () => {
    facts = new InMemoryPatientAccessRepository();
    records = new InMemoryAccessLogRepository();
    professional = professionalIdentity(ORGANIZATION_ID);

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

  it('writes exactly one record when the chart is opened', async () => {
    const patientId = aFollowedPatient();

    await get(`/v1/patients/${patientId}/chart`).expect(200);

    expect(records.rows).toHaveLength(1);
    expect(records.rows[0]).toMatchObject({
      actorProfileId: professional.personId,
      patientProfileId: patientId,
      resource: 'patient_chart',
      action: 'view',
    });
  });

  it('writes one record per visit, and two visits are two records', async () => {
    const patientId = aFollowedPatient();

    await get(`/v1/patients/${patientId}/chart`).expect(200);
    await get(`/v1/patients/${patientId}/chart`).expect(200);

    expect(records.countFor(patientId)).toBe(2);
  });

  it('does not record the other requests of the same screen', async () => {
    // The criterion, in one assertion: a screen that loads three things leaves
    // one line in the patient's list, not three.
    const patientId = aFollowedPatient();

    await get(`/v1/patients/${patientId}/chart`).expect(200);
    await get(`/v1/patients/${patientId}/chart/summary`).expect(200);
    await get(`/v1/patients/${patientId}/chart/summary`).expect(200);

    expect(records.countFor(patientId)).toBe(1);
  });

  it('records an export as an export', async () => {
    const patientId = aFollowedPatient();

    await get(`/v1/patients/${patientId}/chart/export`).expect(200);

    expect(records.rows[0]).toMatchObject({ action: 'export', patientProfileId: patientId });
  });

  it('records nothing when the access was refused', async () => {
    // A professional of another practice gets the same 404 as for a patient
    // who does not exist (ADR 0017), and the patient's list stays as it was:
    // nobody saw anything.
    const stranger = randomUUID();
    facts.addCareRelationship(randomUUID(), stranger);
    facts.grant(stranger);

    await get(`/v1/patients/${stranger}/chart`).expect(404);

    expect(records.rows).toHaveLength(0);
  });

  it('records nothing once the consent is revoked', async () => {
    const patientId = aFollowedPatient();

    await get(`/v1/patients/${patientId}/chart`).expect(200);
    facts.revoke(patientId);
    await get(`/v1/patients/${patientId}/chart`).expect(404);

    expect(records.countFor(patientId)).toBe(1);
  });

  it('records nothing when the handler broke', async () => {
    // The row says what was really served. A request that answered 500 showed
    // the professional nothing, so there is nothing to tell the patient about.
    const patientId = aFollowedPatient();

    await get(`/v1/patients/${patientId}/chart/broken`).expect(500);

    expect(records.rows).toHaveLength(0);
  });

  it('fails the request when the record cannot be written', async () => {
    // Fail closed: an access nobody can prove is worse than an access that did
    // not happen, so the professional gets a 500 instead of a chart.
    const patientId = aFollowedPatient();

    records.append = () => Promise.reject(new Error('the access log is unreachable'));

    await get(`/v1/patients/${patientId}/chart`).expect(500);
  });

  it('fails loudly on a route that has no patient parameter', async () => {
    // A 500 and not a silent "no record": a route decorated by mistake is a
    // bug in our code, and an access nobody is told about is the one failure
    // this interceptor must not have.
    await get('/v1/patients/mine').expect(500);

    expect(records.rows).toHaveLength(0);
  });
});
