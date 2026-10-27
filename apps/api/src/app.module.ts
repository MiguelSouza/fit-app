import { Module, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { HealthCheckModule } from './health-check/health-check.module';
import { IdentityModule } from './modules/identity';
import { NutritionModule } from './modules/nutrition';
import { HealthModule } from './modules/health';
import { InsightsModule } from './modules/insights';
import { AuthModule } from './shared/auth/auth.module';
import { EnvModule } from './shared/config/env.module';
import { EventsModule } from './shared/events/events.module';
import { JobsModule } from './shared/jobs/jobs.module';
import { LoggingModule } from './shared/logging/logging.module';
import { ObservabilityModule } from './shared/observability/observability.module';
import { GlobalExceptionFilter } from './shared/presentation/global-exception.filter';

/**
 * The composition root: the four domain modules of CLAUDE.md, the health
 * check, the logging and the global error handling.
 *
 * Each module is imported through its `index.ts` and nothing else
 * (CLAUDE.md rule 1).
 *
 * `AuthModule` brings a global guard with it, so every route of every module
 * below needs a valid Supabase token unless it says `@Public()`.
 *
 * `ObservabilityModule` carries what Sentry needs from the app: the flush on
 * shutdown and the route that provokes an error (ADR 0013). Starting the client
 * is not its job — that happens in `instrument.ts`, before Nest exists.
 *
 * `EventsModule` is here so the bus exists once for the whole process: a
 * module that publishes or subscribes imports it too, and gets the same one.
 * `JobsModule` is here for the same reason, and because the jobs it holds
 * register themselves with the queue while the app starts.
 */
@Module({
  imports: [
    EnvModule,
    LoggingModule,
    ObservabilityModule,
    AuthModule,
    EventsModule,
    JobsModule,
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

    // Validates every response against the schema its route declares with
    // `SchemaResponse`, and drops whatever the schema does not declare. A
    // route without one is left alone.
    { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
  ],
})
export class AppModule {}
