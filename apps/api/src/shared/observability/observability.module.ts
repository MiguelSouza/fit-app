import { Logger, Module, type OnApplicationShutdown } from '@nestjs/common';

import { EnvModule } from '../config/env.module';
import { SentryCheckController } from './sentry-check.controller';
import { flushSentry } from './sentry';

/**
 * What reporting an error to Sentry needs from the app itself (ADR 0013).
 *
 * The client is started before Nest exists, in `instrument.ts`, because the
 * SDK has to instrument `http` and `express` before they are loaded. What is
 * left here is the end of a task's life and the route that lets somebody check
 * the pipeline.
 */
@Module({
  imports: [EnvModule],
  controllers: [SentryCheckController],
})
export class ObservabilityModule implements OnApplicationShutdown {
  private readonly logger = new Logger('Observability');

  /**
   * Hands whatever is buffered to Sentry before the process goes.
   *
   * ECS sends SIGTERM and kills the task soon after (ADR 0005); an event still
   * in the queue at that point is an event nobody sees — and a deploy is
   * exactly when the interesting errors happen. `enableShutdownHooks()` in
   * `bootstrap.ts` is what makes this run.
   */
  async onApplicationShutdown(): Promise<void> {
    await flushSentry();

    // No count and no event id: the line says the step happened, which is
    // what a deploy log needs.
    this.logger.log('sentry flushed');
  }
}
