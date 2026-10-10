import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type DestinationStream } from 'pino';
import request from 'supertest';

import { AppModule } from '../../app.module';
import { configureApp } from '../../bootstrap';
import { DATABASE_STATUS_PORT } from '../../health-check/application/ports/database-status.port';
import { ENV } from '../config/env.module';
import { type ApiEnv } from '../config/env';
import { CORRELATION_ID_HEADER } from './correlation-id';
import { createLogger, LOGGER } from './logger';

/**
 * The correlation id over real HTTP: the whole `AppModule`, the middleware
 * where it is applied, and the logger replaced by one writing to a stream the
 * test reads.
 *
 * `/v1/health` is used because it is the only route there is; what is under
 * test is the middleware around it.
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  corsAllowedOrigins: [],
  logLevel: 'info',
};

const written: string[] = [];

const destination: DestinationStream = {
  write(line: string): void {
    written.push(line);
  },
};

function lines(): Record<string, unknown>[] {
  return written.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function requestLine(): Record<string, unknown> {
  const line = lines().find((candidate) => candidate.msg === 'request handled');
  if (line === undefined) throw new Error('expected the request to have been logged');

  return line;
}

describe('the correlation id of a request', () => {
  let app: INestApplication;

  beforeEach(async () => {
    written.length = 0;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .overrideProvider(LOGGER)
      .useValue(createLogger(env, destination))
      .overrideProvider(DATABASE_STATUS_PORT)
      .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' as const }) })
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, env);

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers with an id and logs the request under it', async () => {
    const response = await request(app.getHttpServer()).get('/v1/health').expect(200);

    const id = response.headers[CORRELATION_ID_HEADER];

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestLine()).toMatchObject({
      correlationId: id,
      method: 'GET',
      path: '/v1/health',
      statusCode: 200,
    });
    expect(requestLine().durationMs).toEqual(expect.any(Number));
  });

  it('keeps the id the caller sent, so the trace crosses the panel and the api', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/health')
      .set(CORRELATION_ID_HEADER, 'panel-4f2b9c71')
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).toBe('panel-4f2b9c71');
    expect(requestLine()).toMatchObject({ correlationId: 'panel-4f2b9c71' });
  });

  it('replaces an id that is not plain text instead of echoing it', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/health')
      .set(CORRELATION_ID_HEADER, 'id with "quotes" and spaces')
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).not.toContain('quotes');
  });

  it('logs the path without the query string, which can carry a name', async () => {
    // A search box is where a patient's name gets typed, and the query string
    // is where it lands (CLAUDE.md, "Saúde e LGPD").
    await request(app.getHttpServer()).get('/v1/health?q=Ana%20Souza').expect(200);

    const line = requestLine();

    expect(line.path).toBe('/v1/health');
    expect(JSON.stringify(line)).not.toContain('Ana');
  });

  it('logs a request the router answered on its own too', async () => {
    await request(app.getHttpServer()).get('/health').expect(404);

    expect(requestLine()).toMatchObject({ path: '/health', statusCode: 404 });
  });
});
