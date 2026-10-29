import {
  SerializeOptions,
  applyDecorators,
  type StandardSchemaSerializerContextOptions,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';

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

/**
 * The same, for a route that answers **201**: it validates and documents the
 * body of a resource that was just created.
 *
 * It exists because the status code is part of the contract a generated client
 * reads — `openapi-fetch` types the answer per status — so a route that
 * creates something has to declare 201 in the document, not 200 with a note.
 *
 * @param schema the response schema, from `@fit-app/contracts`
 * @param description what the endpoint answers, in pt-BR, for the `/docs`
 */
export function SchemaCreatedResponse(
  schema: ResponseSchema,
  description: string,
): MethodDecorator {
  return applyDecorators(
    SerializeOptions({ schema }),
    ApiCreatedResponse({ standardSchema: schema, description }),
  );
}
