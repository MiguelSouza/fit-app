import {
  SerializeOptions,
  applyDecorators,
  type StandardSchemaSerializerContextOptions,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

/** A schema from `@fit-app/contracts`, as the serializer interceptor takes it. */
type ResponseSchema = NonNullable<StandardSchemaSerializerContextOptions['schema']>;

/**
 * Declares the response contract of a route **once**: the same schema
 * documents the endpoint in the OpenAPI document and validates what the
 * handler returns, through the serializer interceptor registered in
 * `app.module.ts`.
 *
 * Two consequences worth knowing. A response that does not match the schema is
 * a 500, not a wrong body on the wire — it is a bug in the presenter, and the
 * client never sees a shape the contract does not describe. And a key the
 * schema does not declare is dropped instead of serialized, which is the
 * cheap half of "resposta carrega id e código" (CLAUDE.md, "Saúde e LGPD"):
 * an entity that reaches the presenter whole leaves it pruned.
 *
 * @param schema the response schema, from `@fit-app/contracts`
 * @param description what the endpoint answers, in pt-BR, for the `/docs`
 */
export function SchemaResponse(schema: ResponseSchema, description: string): MethodDecorator {
  return applyDecorators(
    SerializeOptions({ schema }),
    ApiOkResponse({ standardSchema: schema, description }),
  );
}
