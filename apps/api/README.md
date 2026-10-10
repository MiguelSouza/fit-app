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

## Configuração

As variáveis que a API usa hoje são `NODE_ENV`, `PORT` (3333 por padrão),
`DATABASE_URL` (obrigatória), `CORS_ALLOWED_ORIGINS` e `LOG_LEVEL`. Todas estão
descritas no [`.env.example`](../../.env.example).

Elas são lidas e validadas uma vez, com Zod, em
[`shared/config/env.ts`](./src/shared/config/env.ts), **antes** de o NestJS
existir. Faltando alguma — ou vindo errada, como uma porta fora da faixa — a API
não sobe: escreve em `stderr` quais são as variáveis com problema, todas de uma
vez, e sai com código 1.

```
$ pnpm --filter api start
Invalid environment. The API did not start because of these variables:
  - DATABASE_URL: is required: copy .env.example to .env and start the local stack with `pnpm db:start`
See .env.example at the root of the repository. No value is printed here on purpose.
```

A mensagem nunca mostra o valor: a `DATABASE_URL` carrega a senha do banco, e
isso não entra em terminal nem em log (`CLAUDE.md`, "Saúde e LGPD"). Variável
sem valor (`PORT=`) conta como variável ausente, então o padrão vale.

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
desaparece — e a resposta continua **200**. Banco que recusa a conexão falha na
hora; banco que fica calado (host inalcançável, pacote descartado, projeto
pausado) tem 2 s de prazo e depois sai como `down`, para o endpoint responder em
vez de pendurar. É relatório de estado, não porta de
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
  shared/            o que atravessa módulo: env, logger, pool do Postgres, erros de domínio
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

## Logs

Uma linha JSON por evento, no stdout. Em staging e produção o stdout da task do
ECS é o stream do CloudWatch (ADR 0005); local, a linha é a mesma — não há
`pino-pretty` nem dependência de formatação (ADR
[0006](../../docs/adr/0006-logger-estruturado-com-pino.md)).

O logger é montado em [`shared/logging/logger.ts`](./src/shared/logging/logger.ts)
e o `main.ts` o entrega ao `app.useLogger`, então tudo que já estava escrito com
`new Logger('AlgumaCoisa')` passa a sair estruturado, sem mudar nada no código:

```json
{
  "level": "info",
  "time": "2026-10-10T03:28:22.731Z",
  "correlationId": "panel-4f2b9c71",
  "method": "GET",
  "path": "/v1/health",
  "statusCode": 200,
  "durationMs": 5.2,
  "msg": "request handled"
}
```

O volume é o `LOG_LEVEL`. Em teste o padrão é `silent`, para uma rodada de jest
não imprimir uma linha por requisição.

### Campo sensível sai mascarado

`CLAUDE.md` ("Saúde e LGPD") não admite dado de saúde nem dado pessoal em log.
Quem decide isso não é quem escreve a chamada: antes de serializar qualquer
coisa, o logger troca por `[redacted]` todo campo cujo **nome** seja sensível —
nome, e-mail, telefone, token, notas, valores de check-in e vizinhos (senha,
`authorization`, cookie, peso, humor, dor) — em qualquer profundidade e dentro
de array. A lista está em
[`shared/logging/sensitive-data.ts`](./src/shared/logging/sensitive-data.ts).

```ts
logger.info({ patientId: 'pat_1', patient: { name: 'Ana Souza' } }, 'patient record opened');
// {"patientId":"pat_1","patient":{"name":"[redacted]"},"msg":"patient record opened"}
```

Três consequências que valem saber:

- A regra erra para o lado de mascarar. Um `fileName` sai como `[redacted]`, e
  está bem: o preço de um inconveniente é menor que o de um e-mail vazado.
- Ela vale para o **objeto**, não para a frase. Então a frase do log é fixa
  ("patient record opened") e o dado vai no objeto, onde a máscara alcança.
- A mensagem de um erro é descartada no log (fica o tipo, o código e a pilha).
  Mensagem de driver cita o valor que quebrou a query — `Key (email)=(...)`.

### Correlation id por requisição

Toda requisição recebe um id que não diz nada sobre ninguém, e ele aparece em
todas as linhas escritas enquanto ela está no ar — inclusive nas de um caso de
uso lá no fundo, porque o id viaja em `AsyncLocalStorage` e não na assinatura
dos métodos.

O id vem do cabeçalho `x-correlation-id`, quando o painel ou o app mandam um
(texto simples, de 8 a 64 caracteres); senão é gerado. A resposta devolve o
mesmo cabeçalho, então é isso que o usuário lê em uma tela de erro e o suporte
usa para achar a requisição.

A linha de fim de requisição é curta de propósito: método, rota, status e
duração. Sem query string — é onde cai o que foi digitado em uma busca, muitas
vezes o nome do paciente — e sem ip nem user agent, que são dado pessoal e não
ajudam a depurar.

## Testes

```bash
pnpm --filter api test
```

Os testes moram ao lado do código, em `*.spec.ts`, e `health-check` tem um
exemplo de cada camada — a tabela está em
[`src/modules/README.md`](./src/modules/README.md). Nada aqui precisa de banco
no ar: os testes de ponta a ponta sobem o `AppModule` de verdade e trocam só o
que não pode subir num teste — o ambiente, a porta do banco e, no teste de
correlation id, o logger, que passa a escrever num stream que o teste lê.

Casos de uso que leem e escrevem dado de paciente vão precisar de Postgres real
com Testcontainers, como manda o `CLAUDE.md` — e de dado sintético dos
[`scripts/`](../../scripts/README.md), nunca dado real.

O jest roda com `--experimental-vm-modules` e compila os testes como ES modules
(`tsconfig.spec.json`). O motivo é o NestJS 12, que é publicado só como ESM:
`require` de ESM dentro do jest só funciona a partir do Node 24.9, e assim os
testes rodam em qualquer Node 24. A aplicação continua compilando como
CommonJS.
