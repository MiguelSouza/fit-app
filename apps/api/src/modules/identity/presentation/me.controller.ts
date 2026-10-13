import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { errorResponseSchema, meResponseSchema, type MeResponse } from '@fit-app/contracts';
import { ApiInternalServerErrorResponse, ApiOperation } from '@nestjs/swagger';

import { SchemaResponse } from '../../../shared/presentation/schema-response.decorator';

/**
 * The answer while `identity` has no people in it.
 *
 * It is a **provisional** endpoint, as card F-09 asks for: what it exists for
 * is to put one real contract end to end — Zod schema, OpenAPI document,
 * generated client — so the next card plugs the authenticated caller into a
 * pipeline that already works.
 *
 * The id is the nil UUID, which is not and will never be a person: no
 * synthetic patient is invented here, and nothing in the response is personal
 * data.
 */
const PROVISIONAL_ME: MeResponse = {
  personId: '00000000-0000-0000-0000-000000000000',
  role: 'professional',
  timeZone: 'America/Sao_Paulo',
};

/**
 * `GET /v1/me`: who the caller is. The version comes from `defaultVersion` in
 * `bootstrap.ts`, so the path here stays version free.
 */
@Controller({ path: 'me' })
export class MeController {
  /**
   * Answers the contract above with a fixed payload, and says so in the
   * documentation. Reading the real identity needs two things this branch does
   * not have: the verified access token (card F-08) and the `identity` tables.
   * Until both land, an endpoint that lies in a documented way beats an
   * endpoint that is not there — the contract it answers is already the real
   * one.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Identidade de quem fez a chamada',
    description:
      'Provisório: responde um payload fixo, com o UUID nulo como `personId`. ' +
      'Passa a ler a pessoa autenticada quando o módulo identity tiver gente dentro.',
  })
  @SchemaResponse(meResponseSchema, 'Identidade de quem fez a chamada')
  @ApiInternalServerErrorResponse({
    standardSchema: errorResponseSchema,
    description: 'Erro inesperado. É o envelope de erro de toda a API',
  })
  get(): MeResponse {
    return PROVISIONAL_ME;
  }
}
