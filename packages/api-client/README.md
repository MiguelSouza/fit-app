# @fit-app/api-client

Cliente TypeScript **gerado** a partir do OpenAPI da API. É o que o painel usa
para falar com a API — nada no painel monta uma URL ou tipa uma resposta à mão
(`CLAUDE.md`, regra 6 e regra 7).

```ts
import { createFitAppApiClient } from '@fit-app/api-client';

const api = createFitAppApiClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL! });

const { data, error } = await api.GET('/v1/me');
//      ^? MeResponse | undefined   ^? ErrorResponse | undefined
```

O caminho, o corpo e a forma da resposta são checados em tempo de compilação
contra o documento: endpoint que não existe não compila, campo que a API deixou
de responder não compila.

## Como é gerado

```
apps/api/openapi.json  ──openapi-typescript──▶  src/generated/openapi.ts
```

`pnpm api:generate`, na raiz do monorepo, roda isso (e mais: ver o README da
raiz). O resultado é **versionado**, para que o painel compile sem precisar
subir a API, e **não é editado à mão** — o lint e o prettier ignoram a pasta.

```
src/
  generated/openapi.ts   gerado; não editar
  index.ts               API pública: o cliente e os DTOs com nome
  contract.ts            os campos que os clientes leem hoje, fixados no tipo
```

`index.ts` dá nome aos DTOs (`MeResponse`, `ProfessionalIdentity`,
`RegisterProfessionalRequest`, `HealthResponse`, `ErrorResponse`) e
expõe `createFitAppApiClient`, uma casca de três linhas em volta do
[`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) — 6 kB, `fetch` por
baixo, sem estado e sem credencial guardada: quem chama passa o token.

`contract.ts` não tem nada em tempo de execução. Ele fixa no tipo os campos que
os clientes já leem, para que renomear ou remover um campo em
`packages/contracts` e regerar **quebre o `pnpm typecheck`** aqui, em vez de
quebrar o painel em produção. Campo novo não quebra nada — a lista é o que já é
lido, não tudo o que existe.

## Scripts

| Script                                        | O que faz                                         |
| --------------------------------------------- | ------------------------------------------------- |
| `pnpm --filter @fit-app/api-client generate`  | gera `src/generated/openapi.ts` do `openapi.json` |
| `pnpm --filter @fit-app/api-client build`     | `tsc`: emite `dist/` com os `.d.ts`               |
| `pnpm --filter @fit-app/api-client typecheck` | `tsc --noEmit`                                    |
| `pnpm --filter @fit-app/api-client lint`      | eslint                                            |

O pacote é emitido como **CommonJS**, que é o formato que o Next.js e a API
leem sem cerimônia.
