import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { HealthCheckModule } from './health-check/health-check.module';
import { IdentityModule } from './modules/identity';
import { NutritionModule } from './modules/nutrition';
import { HealthModule } from './modules/health';
import { InsightsModule } from './modules/insights';
import { EnvModule } from './shared/config/env.module';
import { LoggingModule } from './shared/logging/logging.module';
import { GlobalExceptionFilter } from './shared/presentation/global-exception.filter';

/**
 * The composition root: the four domain modules of CLAUDE.md, the health
 * check, the logging and the global error handling.
 *
 * Each module is imported through its `index.ts` and nothing else
 * (CLAUDE.md rule 1).
 */
@Module({
  imports: [
    EnvModule,
    LoggingModule,
    HealthCheckModule,
    IdentityModule,
    NutritionModule,
    HealthModule,
    InsightsModule,
  ],
  providers: [
    // Registered as a provider, not with `useGlobalFilters`, so the filter can
    // be injected into and so a test that boots this module gets the same
    // error handling the API has.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
