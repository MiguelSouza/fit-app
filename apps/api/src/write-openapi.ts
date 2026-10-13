import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { API_VERSION, configureApp } from './bootstrap';
import { buildOpenApiDocument } from './openapi';
import { loadLocalEnvFile } from './shared/config/env-file';
import { resolveEnv } from './shared/config/env.module';

/**
 * Writes the OpenAPI document of the API to a file. It is the first step of
 * `pnpm api:generate` at the root of the monorepo, and the committed
 * `apps/api/openapi.json` is its output: the clients of every platform are
 * generated from that file, so a contract change shows up as a reviewable diff
 * in the pull request.
 *
 * Usage: `node dist/write-openapi.js <output file>`
 */
const [, , target] = process.argv;

if (target === undefined) {
  process.stderr.write('usage: node dist/write-openapi.js <output file>\n');
  process.exit(1);
}

/**
 * The document is static metadata: the app below is created, read and thrown
 * away without ever listening on a port or touching Postgres. The environment
 * is still parsed while the modules are created, so a connection string that
 * points nowhere is enough — and that is what lets this run on a machine with
 * no `.env`, such as a job that only regenerates the contract.
 *
 * A real `.env` wins: it is loaded first, and these only fill in what it does
 * not set.
 */
loadLocalEnvFile();
process.env['DATABASE_URL'] ??= 'postgresql://openapi:openapi@127.0.0.1:1/openapi';
process.env['LOG_LEVEL'] ??= 'silent';

async function writeDocument(file: string): Promise<void> {
  const env = resolveEnv();

  const app = await NestFactory.create(AppModule, { logger: false });

  // The same configuration the API boots with, so the paths come out as the
  // API serves them: `/v1/me`, not `/me`.
  configureApp(app, env);

  const document = buildOpenApiDocument(app, API_VERSION);

  // Two spaces and a trailing newline, as prettier would write it — the file
  // is in the repository and ends up in diffs next to hand-written json.
  writeFileSync(resolve(file), `${JSON.stringify(document, null, 2)}\n`, 'utf8');

  await app.close();

  process.stdout.write(`openapi document written to ${file}\n`);
}

void writeDocument(target);
