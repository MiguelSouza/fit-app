import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import {
  AccessLogService,
  LoadPatientCaller,
  LoadProfessionalCaller,
  PatientAccessService,
  type PatientCaller,
} from '../../identity';
import { AppModule } from '../../../app.module';
import { configureApp } from '../../../bootstrap';
import { DATABASE_STATUS_PORT } from '../../../health-check/application/ports/database-status.port';
import { TEST_JWT_SECRET } from '../../../shared/auth/local-access-token.spec-support';
import { type ApiEnv } from '../../../shared/config/env';
import { ENV } from '../../../shared/config/env.module';
import { EVENT_BUS } from '../../../shared/events/event-bus.port';
import { RecordingEventBus } from '../../../shared/events/recording-event-bus.spec-support';
import {
  patientAccess,
  patientCallers,
  professionalCallers,
  recordingAccessLog,
  type RecordedAccess,
} from '../application/identity-doubles.spec-support';
import { InMemoryCheckinRepository } from '../application/in-memory-checkin-repository.spec-support';
import { CHECKIN_REPOSITORY } from '../application/ports/checkin-repository.port';

/**
 * The real `AppModule` over HTTP, with the seams a `health` suite needs: the
 * check-ins, the event bus, and the four things this module asks `identity` for
 * (`identity-doubles.spec-support.ts`, which explains why those four and not
 * something deeper).
 *
 * Everything else is the API as it runs: the route, the global guard, the
 * validation pipe, the serializer, the access guard, the access log
 * interceptor and the error filter. What no fake can answer for is the SQL, and
 * that is `checkins.use-case.integration-spec.ts`.
 *
 * Not a `*.spec.ts` file, so jest does not read it as a suite, and excluded
 * from `tsconfig.build.json`, so it never reaches `dist/`.
 */
export const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: TEST_JWT_SECRET,
  corsAllowedOrigins: [],
  jobsEnabled: false,
  logLevel: 'silent',
};

/** What a suite hands over, and what it gets back to make assertions on. */
export interface HealthApp {
  readonly app: INestApplication;
  readonly checkins: InMemoryCheckinRepository;
  readonly events: RecordingEventBus;
  /** What `identity.logAccess` was asked to record, in order. */
  readonly accesses: RecordedAccess[];
}

export interface HealthAppOptions {
  /**
   * Who the caller is, when they are a patient. Absent means `identity`
   * refuses them as one — which is what it does to a professional (403).
   */
  readonly patient?: PatientCaller | undefined;

  /**
   * The profile id of the caller, when they are a professional. Absent means
   * `identity` refuses them as one (403).
   */
  readonly professionalId?: string | undefined;

  /**
   * Whether the access rule lets that professional reach the patient in the
   * path. `false` is the only refusal there is, and it is a 404 — the rule does
   * not distinguish no link, no consent and no patient (ADR 0017).
   */
  readonly accessGranted?: boolean | undefined;

  /** The check-ins already there. A fresh, empty one when absent. */
  readonly checkins?: InMemoryCheckinRepository | undefined;
}

export async function bootHealthApp(options: HealthAppOptions = {}): Promise<HealthApp> {
  const checkins = options.checkins ?? new InMemoryCheckinRepository();
  const events = new RecordingEventBus();
  const accesses: RecordedAccess[] = [];

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE_STATUS_PORT)
    .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' }) })
    .overrideProvider(CHECKIN_REPOSITORY)
    .useValue(checkins)
    .overrideProvider(EVENT_BUS)
    .useValue(events)
    .overrideProvider(LoadPatientCaller)
    .useValue(patientCallers(options.patient))
    .overrideProvider(LoadProfessionalCaller)
    .useValue(professionalCallers(options.professionalId))
    .overrideProvider(PatientAccessService)
    .useValue(patientAccess(options.accessGranted ?? false))
    .overrideProvider(AccessLogService)
    .useValue(recordingAccessLog(accesses))
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, env);

  return { app: await app.init(), checkins, events, accesses };
}
