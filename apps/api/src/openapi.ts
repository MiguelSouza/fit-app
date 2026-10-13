import { type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import { type ApiEnv } from './shared/config/env';

/** Where the interactive documentation answers, outside production. */
export const DOCS_PATH = 'docs';

const TITLE = 'fit-app API';

const DESCRIPTION = [
  'API da plataforma para nutricionistas esportivos.',
  '',
  'Os schemas vêm de `packages/contracts` (Zod) e são a fonte da verdade dos DTOs:',
  'este documento é gerado a partir deles, e o cliente de cada plataforma é gerado',
  'a partir deste documento (`pnpm api:generate`).',
  '',
  'Todo erro responde no mesmo envelope, `{ "error": { "code", "message" } }`, em que',
  '`code` é a chave de i18n do cliente.',
].join('\n');

/**
 * Builds the OpenAPI document by reading the app that is already wired: the
 * routes come from the controllers, and the schema of each response from the
 * Zod schema the route declares with `SchemaResponse`.
 *
 * Nothing here is written by hand, which is the point — a document maintained
 * on the side is a document that lies.
 *
 * @param app the app, with the versioning of `configureApp` already on, so the
 *   paths come out as `/v1/...`
 * @param version what goes in `info.version`
 */
export function buildOpenApiDocument(app: INestApplication, version: string): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(TITLE)
    .setDescription(DESCRIPTION)
    .setVersion(version)
    .build();

  // `autoTagControllers` groups the routes in the `/docs` by controller
  // (`Me`, `Health`), which is as far as grouping needs to go while the API
  // has one endpoint per module.
  return SwaggerModule.createDocument(app, config, { autoTagControllers: true });
}

/**
 * Serves the documentation at `/docs` — **never in production**.
 *
 * It is the map of the API: every route, every field and every example in one
 * page. In production that is reconnaissance material, and the people who need
 * it (us) read it from the generated `apps/api/openapi.json` or from a local
 * run. The endpoints themselves are unaffected either way: the document is
 * metadata, not behaviour.
 */
export function serveOpenApiDocs(app: INestApplication, env: ApiEnv, version: string): void {
  if (env.nodeEnv === 'production') return;

  SwaggerModule.setup(DOCS_PATH, app, () => buildOpenApiDocument(app, version), {
    customSiteTitle: `${TITLE} — docs`,

    // The same document the clients are generated from, served next to the
    // page: it is what a consumer points a generator at while developing,
    // without waiting for the regenerated file to land in the repository.
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    yamlDocumentUrl: `${DOCS_PATH}/openapi.yaml`,
  });
}
