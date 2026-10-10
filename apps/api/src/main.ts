import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { API_VERSION, configureApp } from './bootstrap';
import { loadLocalEnvFile } from './shared/config/env-file';
import { EnvironmentError, type ApiEnv } from './shared/config/env';
import { resolveEnv } from './shared/config/env.module';
import { PinoLoggerService } from './shared/logging/pino-logger.service';

/**
 * Reads the environment before anything else exists, and stops the process
 * with a readable message if it is not usable.
 *
 * Written straight to stderr, not through a logger: the logger's own level
 * comes from the configuration that just failed, and a stack trace of the
 * parser would bury the one line that matters — which variable is wrong.
 */
function readEnvOrExit(): ApiEnv {
  try {
    return resolveEnv();
  } catch (error) {
    if (!(error instanceof EnvironmentError)) throw error;

    process.stderr.write(`${error.message}\n`);

    return process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  // Before the modules: `EnvModule` reads `process.env` while it is being
  // created.
  loadLocalEnvFile();

  const env = readEnvOrExit();

  // `bufferLogs` holds the framework's own boot messages until the logger
  // below is in place, so not even those go out unstructured.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(PinoLoggerService));
  app.flushLogs();

  configureApp(app, env);

  await app.listen(env.port);

  // Port and version only. No url with credentials, nothing personal.
  new Logger('Bootstrap').log(`api listening on port ${env.port} under /v${API_VERSION}`);
}

void bootstrap();
