import { Module } from '@nestjs/common';

import { loadEnv, type ApiEnv } from './env';

/**
 * Injection token for the parsed environment. A test overrides this provider
 * instead of writing to `process.env`.
 */
export const ENV = Symbol('fit-app.api.env');

let parsed: ApiEnv | undefined;

/**
 * The environment, parsed on the first call and remembered.
 *
 * `main.ts` calls this before creating the app so a missing variable is a
 * message and an exit code instead of a stack trace from inside the injector;
 * the provider below then gets the same object back, already validated.
 *
 * @throws EnvironmentError naming every variable that is missing or unusable
 */
export function resolveEnv(): ApiEnv {
  parsed ??= loadEnv(process.env);

  return parsed;
}

/**
 * Parses the environment once and hands the result to whoever asks for `ENV`.
 * It fails at startup, not on the first request: a missing variable should not
 * look like a runtime bug.
 */
@Module({
  providers: [{ provide: ENV, useFactory: resolveEnv }],
  exports: [ENV],
})
export class EnvModule {}
