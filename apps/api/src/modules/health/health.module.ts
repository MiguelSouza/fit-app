import { Module } from '@nestjs/common';

import { IdentityModule } from '../identity';
import { DatabaseModule } from '../../shared/database/database.module';
import { EventsModule } from '../../shared/events/events.module';
import { ListMyCheckinsUseCase } from './application/list-my-checkins.use-case';
import { ListPatientCheckinsUseCase } from './application/list-patient-checkins.use-case';
import { CHECKIN_REPOSITORY } from './application/ports/checkin-repository.port';
import { RecordCheckinUseCase } from './application/record-checkin.use-case';
import { DrizzleCheckinRepository } from './infrastructure/drizzle-checkin.repository';
import { MyCheckinsController } from './presentation/my-checkins.controller';
import { PatientCheckinsController } from './presentation/patient-checkins.controller';

/**
 * `health`: conexões de wearable, atividades, sono, métricas diárias,
 * check-ins, medidas.
 *
 * Owns the `health` Postgres schema and reads nothing else (CLAUDE.md rule 2).
 * Where the port meets its adapter is right here: the use cases ask for
 * `CHECKIN_REPOSITORY` and this module decides that Postgres is what answers
 * it.
 *
 * What is wired today is card P-02, the daily check-in: the patient saves the
 * day and reads their own history, and a professional with an active link and
 * the consent in force reads theirs. The wearable half of the module — the
 * aggregator behind its own port (ADR 0003), the activities, the nights of
 * sleep, the daily metrics — and the measurements are other cards.
 *
 * **`IdentityModule` is imported, and that is how this module asks another one
 * for what it owns** (rule 2: call its public service, never read its tables).
 * Three things come from there and each is an obligation, not a convenience:
 * who is calling (`LoadPatientCaller`, `LoadProfessionalCaller`), whether a
 * professional may see a patient (`PatientAccessService`, and the guard behind
 * `@RequiresPatientAccess()`), and the recording of that access
 * (`AccessLogService`, behind `@RecordsPatientAccess()`). The import is of the
 * module's `index.ts` and of nothing inside it (rule 1).
 *
 * `EventsModule` is here for the one fact this module announces today, a
 * check-in recorded. It exports `EVENT_BUS`, and the publisher never names the
 * implementation (ADR 0009).
 */
@Module({
  imports: [DatabaseModule, EventsModule, IdentityModule],
  controllers: [MyCheckinsController, PatientCheckinsController],
  providers: [
    RecordCheckinUseCase,
    ListMyCheckinsUseCase,
    ListPatientCheckinsUseCase,
    { provide: CHECKIN_REPOSITORY, useClass: DrizzleCheckinRepository },
  ],
})
export class HealthModule {}
