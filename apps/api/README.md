# @fit-app/api

API NestJS: monólito modular com os módulos `identity`, `nutrition`, `health` e
`insights`. É a única coisa que fala com o banco — painel e app só falam com ela
(`CLAUDE.md`, regra 6).

## Como rodar

```bash
cp ../../.env.example ../../.env   # uma vez, na raiz do monorepo
pnpm db:start                      # Postgres local (Supabase), na raiz
pnpm --filter api dev              # sobe a API em modo watch
```

A API lê o `.env` da raiz do monorepo no começo do `main.ts`. Variável já
exportada no shell ganha do arquivo, e em staging e produção não existe arquivo
nenhum: os valores vêm da task definition e do AWS Secrets Manager (ADR 0005).

| Script                        | O que faz                                     |
| ----------------------------- | --------------------------------------------- |
| `pnpm --filter api dev`       | `nest start --watch`                          |
| `pnpm --filter api build`     | `nest build`, emite em `dist/`                |
| `pnpm --filter api start`     | roda o `dist/main.js` já compilado            |
| `pnpm --filter api test`      | jest, os testes `*.spec.ts` ao lado do código |
| `pnpm --filter api lint`      | eslint, com a fronteira entre módulos         |
| `pnpm --filter api typecheck` | `tsc --noEmit`                                |

As variáveis que a API usa hoje são `NODE_ENV`, `PORT` (3333 por padrão),
`DATABASE_URL` (obrigatória) e `CORS_ALLOWED_ORIGINS`. Todas estão descritas no
[`.env.example`](../../.env.example).

## `GET /v1/health`

Único endpoint por enquanto. Responde o estado do processo e do banco:

```bash
curl http://127.0.0.1:3333/v1/health
```

```json
{
  "status": "ok",
  "checks": [
    { "name": "api", "status": "up" },
    { "name": "database", "status": "up", "latencyMs": 3 }
  ]
}
```

Com o banco fora do ar o `status` vira `degraded`, o `latencyMs` do banco
desaparece — e a resposta continua **200**. É relatório de estado, não porta de
entrada: um soluço do Postgres não deve derrubar o health check de todas as
tasks de uma vez e tirar o serviço inteiro do balanceador. A sonda que tira uma
task de rotação entra com o card de ECS e ALB, junto do target group que a lê.

## Rotas e versão

O versionamento é por URI, com `defaultVersion: '1'`: todo controller responde
sob `/v1` sem escrever isso no `@Controller`. Uma rota que precise mudar de
forma declara `@Version('2')` sozinha, e o resto continua em `/v1`.

## Estrutura

```
src/
  main.ts            bootstrap: lê o .env, cria o app, escuta a porta
  bootstrap.ts       versionamento e CORS — o mesmo que o teste e2e usa
  app.module.ts      composition root: os 4 módulos, o health check, o filtro de erros
  modules/           os módulos de domínio (ver modules/README.md)
  health-check/      o GET /v1/health, em quatro camadas. É o exemplo a copiar
  shared/            o que atravessa módulo: env, pool do Postgres, erros de domínio
```

`health-check` não é módulo de domínio: ele responde pelo estado do processo. O
módulo `health` é outra coisa — é o dado de saúde do paciente (sono, atividade,
check-in).

## Erros

Erro de domínio é classe própria em
[`shared/domain/domain-error.ts`](./src/shared/domain/domain-error.ts), e virar
HTTP acontece em um lugar só, o
[filtro global](./src/shared/presentation/global-exception.filter.ts) — camada
`presentation`, como manda o `CLAUDE.md`. `domain/` e `application/` não sabem o
que é status code.

| `kind`              | HTTP | Quando                                               |
| ------------------- | ---- | ---------------------------------------------------- |
| `invalid_input`     | 400  | requisição malformada ou valor inaceitável           |
| `permission_denied` | 403  | sem vínculo ativo, sem consentimento, tipo errado    |
| `not_found`         | 404  | o registro não existe (ou não cabe dizer que existe) |
| `conflict`          | 409  | o estado atual do registro não permite a operação    |
| `rule_violation`    | 422  | entrada bem formada que uma regra de domínio recusa  |

O corpo é sempre o mesmo, e o `code` é a chave de i18n do cliente:

```json
{ "error": { "code": "nutrition.plan.not_found", "message": "Plano não encontrado." } }
```

Erro inesperado vira 500 com mensagem genérica. O log fica com o nome do erro e
a pilha **sem a primeira linha**: a mensagem do driver pode citar o valor de uma
coluna, e dado pessoal não entra em log (`CLAUDE.md`, "Saúde e LGPD").

## Testes

```bash
pnpm --filter api test
```

Os testes moram ao lado do código, em `*.spec.ts`, e `health-check` tem um
exemplo de cada camada — a tabela está em
[`src/modules/README.md`](./src/modules/README.md). Nada aqui precisa de banco
no ar: o teste de ponta a ponta sobe o `AppModule` de verdade e troca só dois
providers, o ambiente e a porta do banco.

Casos de uso que leem e escrevem dado de paciente vão precisar de Postgres real
com Testcontainers, como manda o `CLAUDE.md` — e de dado sintético dos
[`scripts/`](../../scripts/README.md), nunca dado real.

O jest roda com `--experimental-vm-modules` e compila os testes como ES modules
(`tsconfig.spec.json`). O motivo é o NestJS 12, que é publicado só como ESM:
`require` de ESM dentro do jest só funciona a partir do Node 24.9, e assim os
testes rodam em qualquer Node 24. A aplicação continua compilando como
CommonJS.
