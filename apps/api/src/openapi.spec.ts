import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './app.module';
import { API_VERSION, configureApp } from './bootstrap';
import { DOCS_PATH, buildOpenApiDocument } from './openapi';
import { DATABASE_STATUS_PORT } from './health-check/application/ports/database-status.port';
import { ENV } from './shared/config/env.module';
import { type ApiEnv, type NodeEnv } from './shared/config/env';

/**
 * What card F-09 asks to be true: the example endpoint shows up in the OpenAPI
 * document with the right schema. The document is built from the real
 * `AppModule`, the same way `write-openapi.ts` builds the file the clients are
 * generated from — so this test fails the moment a route stops declaring its
 * contract, which is the moment a client would be generated without it.
 */
function envFor(nodeEnv: NodeEnv): ApiEnv {
  return {
    nodeEnv,
    port: 0,
    databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
    supabaseJwtSecret: 'unused-in-this-test-but-long-enough-0001',
    corsAllowedOrigins: [],
    jobsEnabled: false,
    logLevel: 'silent',
  };
}

async function bootApp(nodeEnv: NodeEnv): Promise<INestApplication> {
  const env = envFor(nodeEnv);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(DATABASE_STATUS_PORT)
    .useValue({ check: () => Promise.resolve({ name: 'database', status: 'up' }) })
    .compile();

  const app = moduleRef.createNestApplication();
  configureApp(app, env);

  return app.init();
}

describe('the openapi document', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('describes GET /v1/me with the schema of the contract', async () => {
    app = await bootApp('test');

    const document = buildOpenApiDocument(app, API_VERSION);
    const response = document.paths['/v1/me']?.get?.responses['200'];

    expect(response).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/MeResponse' } },
      },
    });

    // The component itself, which is what the generated client turns into a
    // type: the three fields of `meResponseSchema`, all required, with the
    // enum of `personRoleSchema` referenced instead of inlined.
    expect(document.components?.schemas?.['MeResponse']).toMatchObject({
      type: 'object',
      required: ['personId', 'role', 'timeZone'],
      properties: {
        personId: { type: 'string', format: 'uuid' },
        role: { $ref: '#/components/schemas/PersonRole' },
        timeZone: { type: 'string' },
      },
    });

    expect(document.components?.schemas?.['PersonRole']).toMatchObject({
      type: 'string',
      enum: ['professional', 'patient'],
    });
  });

  it('describes the professional half of the identity, optional and by reference', async () => {
    app = await bootApp('test');

    const document = buildOpenApiDocument(app, API_VERSION);

    // Optional, which is to say outside `required`: a patient has no council
    // number and belongs to no organization, and the generated client types it
    // as a field that may not be there.
    expect(document.components?.schemas?.['MeResponse']).toMatchObject({
      properties: {
        professional: { allOf: [{ $ref: '#/components/schemas/ProfessionalIdentity' }] },
      },
    });

    expect(document.components?.schemas?.['ProfessionalIdentity']).toMatchObject({
      type: 'object',
      required: ['type', 'councilNumber', 'organizations'],
      properties: {
        type: { $ref: '#/components/schemas/ProfessionalType' },
        organizations: { items: { $ref: '#/components/schemas/OrganizationMembership' } },
      },
    });

    expect(document.components?.schemas?.['ProfessionalType']).toMatchObject({
      type: 'string',
      enum: ['nutritionist', 'trainer'],
    });
  });

  it('describes POST /v1/professionals/me with the body of the contract', async () => {
    app = await bootApp('test');

    const document = buildOpenApiDocument(app, API_VERSION);
    const route = document.paths['/v1/professionals/me']?.post;

    // The body comes from the schema the handler declares in `@Body({ schema })`
    // — one declaration validates the request and documents it, which is what
    // keeps the generated client from being typed by hand (ADR 0008).
    expect(route?.requestBody).toMatchObject({
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/RegisterProfessionalRequest' },
        },
      },
    });

    // 200 and not 201: the endpoint is idempotent, and the clients type the
    // answer by status code.
    expect(route?.responses['200']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/MeResponse' } },
      },
    });

    expect(document.components?.schemas?.['RegisterProfessionalRequest']).toMatchObject({
      type: 'object',
      required: ['fullName', 'councilNumber'],
    });
  });

  it('describes the error envelope every client has to read', async () => {
    app = await bootApp('test');

    const document = buildOpenApiDocument(app, API_VERSION);

    expect(document.paths['/v1/me']?.get?.responses['500']).toMatchObject({
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
      },
    });
  });

  it('serves the docs outside production', async () => {
    app = await bootApp('development');

    await request(app.getHttpServer()).get(`/${DOCS_PATH}`).expect(200);
    await request(app.getHttpServer())
      .get(`/${DOCS_PATH}/openapi.json`)
      .expect(200)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toMatchObject({ info: { title: 'fit-app API' } });
      });
  });

  it('does not serve the docs in production', async () => {
    app = await bootApp('production');

    await request(app.getHttpServer()).get(`/${DOCS_PATH}`).expect(404);
    await request(app.getHttpServer()).get(`/${DOCS_PATH}/openapi.json`).expect(404);
  });
});
