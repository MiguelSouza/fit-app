import { VersioningType, type INestApplication } from '@nestjs/common';

import { serveOpenApiDocs } from './openapi';
import { type ApiEnv } from './shared/config/env';
import { createSchemaValidationPipe } from './shared/presentation/schema-validation';

/**
 * The version every route answers under while there is only one. A route that
 * one day needs to change shape declares `@Version('2')` on its own; the rest
 * keeps answering under `/v1`.
 */
export const API_VERSION = '1';

/**
 * Everything the HTTP app needs beyond its modules: URI versioning, the
 * validation of every request against its schema, CORS and the `/docs`.
 *
 * It lives apart from `main.ts` so the end-to-end test boots the app exactly
 * as production does. If this ran inside `bootstrap()`, a test would be
 * configuring a second, slightly different app, and `/v1/health` could pass
 * there while 404ing for real.
 */
export function configureApp(app: INestApplication, env: ApiEnv): void {
  // `VersioningType.URI` puts the version in the path: `/v1/health`.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_VERSION });

  // Every `@Body`, `@Query` and `@Param` that declares a schema from
  // `@fit-app/contracts` is validated against it before the handler runs
  // (CLAUDE.md rule 7).
  app.useGlobalPipes(createSchemaValidationPipe());

  // No origin configured means nothing in a browser is expected to call the
  // API, and CORS stays off instead of being opened to everyone.
  if (env.corsAllowedOrigins.length > 0) {
    app.enableCors({ origin: [...env.corsAllowedOrigins], credentials: true });
  }

  // Outside production only, and after the routes exist: the document is read
  // from the app itself.
  serveOpenApiDocs(app, env, API_VERSION);

  // Lets `onApplicationShutdown` run on SIGTERM, which is how ECS stops a
  // task: without it the connection pool is never closed.
  app.enableShutdownHooks();
}
