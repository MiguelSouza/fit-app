import { VersioningType, type INestApplication } from '@nestjs/common';

import { type ApiEnv } from './shared/config/env';

/**
 * The version every route answers under while there is only one. A route that
 * one day needs to change shape declares `@Version('2')` on its own; the rest
 * keeps answering under `/v1`.
 */
export const API_VERSION = '1';

/**
 * Everything the HTTP app needs beyond its modules: URI versioning and CORS.
 *
 * It lives apart from `main.ts` so the end-to-end test boots the app exactly
 * as production does. If this ran inside `bootstrap()`, a test would be
 * configuring a second, slightly different app, and `/v1/health` could pass
 * there while 404ing for real.
 */
export function configureApp(app: INestApplication, env: ApiEnv): void {
  // `VersioningType.URI` puts the version in the path: `/v1/health`.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  // No origin configured means nothing in a browser is expected to call the
  // API, and CORS stays off instead of being opened to everyone.
  if (env.corsAllowedOrigins.length > 0) {
    app.enableCors({ origin: [...env.corsAllowedOrigins], credentials: true });
  }

  // Lets `onApplicationShutdown` run on SIGTERM, which is how ECS stops a
  // task: without it the connection pool is never closed.
  app.enableShutdownHooks();
}
