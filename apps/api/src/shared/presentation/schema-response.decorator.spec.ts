import {
  Controller,
  Get,
  StandardSchemaSerializerInterceptor,
  type INestApplication,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { meResponseSchema, type MeResponse } from '@fit-app/contracts';
import request from 'supertest';

import { GlobalExceptionFilter } from './global-exception.filter';
import { SchemaResponse } from './schema-response.decorator';

const ME: MeResponse = {
  personId: '7b4ba3f4-0f64-4e9b-9b20-1e4d6b9f0a21',
  role: 'professional',
  timeZone: 'America/Sao_Paulo',
};

/**
 * Two routes that exist only here: one that answers more than its contract
 * declares, and one that answers less. Both are mistakes a presenter can make,
 * and what the test pins down is what the client sees when they happen.
 */
@Controller({ path: 'people' })
class PeopleController {
  @Get('generous')
  @SchemaResponse(meResponseSchema, 'Identidade de quem fez a chamada')
  generous(): MeResponse {
    // A whole entity reaching the presenter, personal data and all.
    return { ...ME, email: 'ana@example.com' } as MeResponse;
  }

  @Get('broken')
  @SchemaResponse(meResponseSchema, 'Identidade de quem fez a chamada')
  broken(): MeResponse {
    return { ...ME, role: 'coach' as MeResponse['role'] };
  }
}

async function bootApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [PeopleController],
    providers: [
      { provide: APP_FILTER, useClass: GlobalExceptionFilter },
      { provide: APP_INTERCEPTOR, useClass: StandardSchemaSerializerInterceptor },
    ],
  }).compile();

  // `logger: false`: the 500 below is a pass, and the filter logs it on
  // purpose. Without this, that expected stack lands in the test output.
  return moduleRef.createNestApplication({ logger: false }).init();
}

describe('a response declared with SchemaResponse', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await bootApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('drops what the schema does not declare', async () => {
    const response = await request(app.getHttpServer()).get('/people/generous').expect(200);

    expect(response.body).toEqual(ME);
  });

  it('answers 500 instead of a body the contract does not describe', async () => {
    const response = await request(app.getHttpServer()).get('/people/broken').expect(500);

    expect(response.body).toEqual({
      error: {
        code: 'api.internal_error',
        message: 'Não foi possível concluir a operação. Tente novamente.',
      },
    });
  });
});
