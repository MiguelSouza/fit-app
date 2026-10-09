import { Module } from '@nestjs/common';

import { CheckSystemHealthUseCase } from './application/check-system-health.use-case';
import { DATABASE_STATUS_PORT } from './application/ports/database-status.port';
import { PostgresDatabaseStatusChecker } from './infrastructure/postgres-database-status.checker';
import { HealthController } from './presentation/health.controller';
import { DatabaseModule } from '../shared/database/database.module';

/**
 * Where the port meets its adapter: the use case asks for
 * `DATABASE_STATUS_PORT` and the module decides that Postgres is what answers
 * it today.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [
    CheckSystemHealthUseCase,
    { provide: DATABASE_STATUS_PORT, useClass: PostgresDatabaseStatusChecker },
  ],
})
export class HealthCheckModule {}
