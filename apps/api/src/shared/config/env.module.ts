import { Module } from '@nestjs/common';

import { loadEnv, type ApiEnv } from './env';

/**
 * Injection token for the parsed environment. A test overrides this provider
 * instead of writing to `process.env`.
 */
export const ENV = Symbol('fit-app.api.env');

/**
 * Parses the environment once and hands the result to whoever asks for `ENV`.
 * It fails at startup, not on the first request: a missing variable should not
 * look like a runtime bug.
 */
@Module({
  providers: [{ provide: ENV, useFactory: (): ApiEnv => loadEnv(process.env) }],
  exports: [ENV],
})
export class EnvModule {}
