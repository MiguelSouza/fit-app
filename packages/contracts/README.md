# @fit-app/contracts

Schemas Zod, tipos e enums compartilhados: **fonte da verdade dos DTOs** da
plataforma (`CLAUDE.md`, regra 7 — "Contratos primeiro").

Todo DTO nasce aqui. A API valida entrada e saída contra estes schemas e gera o
OpenAPI a partir deles; o painel e o app recebem os tipos pelo cliente gerado
desse OpenAPI, em [`packages/api-client`](../api-client/README.md).

```
src/
  health-check/   GET /v1/health
  identity/       pessoas, vínculos, consentimentos
  shared/         o que toda resposta pode trazer (corpo de erro)
  index.ts        API pública do pacote: é o que os outros importam
```

Uma pasta por módulo da API, com o mesmo nome. Nada aqui importa NestJS, banco
ou qualquer coisa com I/O: o pacote é lido pela API, pelo Next.js e por um
gerador de código.

## Como escrever um schema

```ts
export const meResponseSchema = z
  .object({ personId: z.uuid(), role: personRoleSchema })
  .meta({ id: 'MeResponse', description: 'Identidade de quem fez a chamada' });

export type MeResponse = z.infer<typeof meResponseSchema>;
```

Três regras:

- **`id` em todo schema que vira componente do OpenAPI.** É ele que nomeia o
  `components/schemas/MeResponse` do documento e, por consequência, o tipo no
  cliente gerado. Renomear um `id` é mudança de contrato.
- **`description` e `example` nos campos**, em pt-BR. Eles aparecem no `/docs` e
  na documentação do cliente — é a única documentação que o consumidor lê.
- **O tipo é inferido, nunca escrito à mão** (`z.infer`). Tipo escrito duas
  vezes é tipo que vai divergir do schema.

E uma regra de produto, que o tipo não pega: resposta carrega **id e código**.
Nome, e-mail, telefone, valor de check-in e nota de paciente só entram onde o
caso de uso registra o acesso (`CLAUDE.md`, "Saúde e LGPD").

## Scripts

| Script                                       | O que faz                           |
| -------------------------------------------- | ----------------------------------- |
| `pnpm --filter @fit-app/contracts build`     | `tsc`: emite `dist/` com os `.d.ts` |
| `pnpm --filter @fit-app/contracts typecheck` | `tsc --noEmit`                      |
| `pnpm --filter @fit-app/contracts lint`      | eslint                              |

O pacote é emitido como **CommonJS**, que é como o `@nestjs/cli` compila a API e
como ela o carrega. Mudou um schema? Rode `pnpm api:generate` na raiz: ele
regera o OpenAPI e os clientes, e a compilação quebra em quem usava o campo
antigo.
