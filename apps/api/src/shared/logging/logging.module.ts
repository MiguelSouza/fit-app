import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { ENV, EnvModule } from '../config/env.module';
import { type ApiEnv } from '../config/env';
import { createLogger, LOGGER, type AppLogger } from './logger';
import { PinoLoggerService } from './pino-logger.service';
import { RequestContextMiddleware } from './request-context.middleware';

/**
 * The logging of the API in one place: the pino instance, the adapter that
 * makes NestJS write through it, and the middleware that gives each request a
 * correlation id.
 *
 * A test overrides `LOGGER` with a logger writing to a stream it can read,
 * which is how the redaction is proved end to end.
 */
@Module({
  imports: [EnvModule],
  providers: [
    {
      provide: LOGGER,
      inject: [ENV],
      useFactory: (env: ApiEnv): AppLogger => createLogger(env),
    },
    PinoLoggerService,
  ],
  exports: [LOGGER, PinoLoggerService],
})
export class LoggingModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // `{*splat}` is how Express 5 spells "every path"; a bare `*` throws.
    consumer.apply(RequestContextMiddleware).forRoutes('{*splat}');
  }
}
