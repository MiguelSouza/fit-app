import { Body, Controller, Post, type INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { meResponseSchema, type MeResponse } from '@fit-app/contracts';
import request from 'supertest';

import { GlobalExceptionFilter } from './global-exception.filter';
import {
  INVALID_REQUEST_CODE,
  createSchemaValidationPipe,
  invalidRequest,
} from './schema-validation';

/**
 * A route that exists only here, to exercise the pipe over a real request.
 * The schema is a real one from `@fit-app/contracts` — no DTO is invented for
 * a test — and the handler echoes what reached it, which is how the test sees
 * what the pipe let through.
 */
@Controller({ path: 'bodies' })
class BodyController {
  @Post()
  create(@Body({ schema: meResponseSchema }) body: MeResponse): MeResponse {
    return body;
  }
}

const VALID: MeResponse = {
  personId: '7b4ba3f4-0f64-4e9b-9b20-1e4d6b9f0a21',
  role: 'professional',
  timeZone: 'America/Sao_Paulo',
};

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [BodyController],
    providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(createSchemaValidationPipe());

  return app.init();
}

describe('invalidRequest', () => {
  it('names the fields the schema complained about, and no value', () => {
    const error = invalidRequest([
      { message: 'invalid uuid', path: ['personId'] },
      { message: 'required', path: ['meals', 0, { key: 'foodId' }] },
    ]);

    expect(error.code).toBe(INVALID_REQUEST_CODE);
    expect(error.message).toBe('Requisição inválida. Revise: personId, meals.0.foodId.');
    expect(error.kind).toBe('invalid_input');
  });

  it('says only that the request is invalid when no field is named', () => {
    const error = invalidRequest([{ message: 'expected object, received string' }]);

    expect(error.message).toBe('Requisição inválida.');
  });

  it('names a field once, however many issues it has', () => {
    const error = invalidRequest([
      { message: 'invalid uuid', path: ['personId'] },
      { message: 'too short', path: ['personId'] },
    ]);

    expect(error.message).toBe('Requisição inválida. Revise: personId.');
  });
});

describe('a request validated against its schema', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await bootApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('comes back refused in the error envelope of the api', async () => {
    const response = await request(app.getHttpServer())
      .post('/bodies')
      .send({ ...VALID, personId: 'not-a-uuid' })
      .expect(400);

    expect(response.body).toEqual({
      error: {
        code: INVALID_REQUEST_CODE,
        message: 'Requisição inválida. Revise: personId.',
      },
    });
  });

  it('reaches the handler with what the schema declares, and nothing else', async () => {
    const response = await request(app.getHttpServer())
      .post('/bodies')
      .send({ ...VALID, isAdmin: true })
      .expect(201);

    expect(response.body).toEqual(VALID);
  });
});
