import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { API_VERSION, configureApp } from './bootstrap';
import { loadLocalEnvFile } from './shared/config/env-file';
import { type ApiEnv } from './shared/config/env';
import { ENV } from './shared/config/env.module';

async function bootstrap(): Promise<void> {
  // Before the modules: `EnvModule` reads `process.env` while it is being
  // created.
  loadLocalEnvFile();

  const app = await NestFactory.create(AppModule);
  const env = app.get<ApiEnv>(ENV);

  configureApp(app, env);

  await app.listen(env.port);

  // Port and version only. No url with credentials, nothing personal.
  new Logger('Bootstrap').log(`api listening on port ${env.port} under /v${API_VERSION}`);
}

void bootstrap();
