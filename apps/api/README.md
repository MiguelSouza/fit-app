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

| Script                               | O que faz                                                       |
| ------------------------------------ | --------------------------------------------------------------- |
| `pnpm --filter api dev`              | `nest start --watch`                                            |
| `pnpm --filter api build`            | `nest build`, emite em `dist/`                                  |
| `pnpm --filter api start`            | roda o `dist/main.js` já compilado                              |
| `pnpm --filter api openapi:write`    | compila e escreve o `openapi.json` deste pacote                 |
| `pnpm --filter api test`             | apelido de `test:unit`                                          |
| `pnpm --filter api test:unit`        | jest, os `*.spec.ts` ao lado do código; não precisa de Docker   |
| `pnpm --filter api test:integration` | jest, os `*.integration-spec.ts`, num Postgres descartável      |
| `pnpm --filter api lint`             | eslint, com a fronteira entre módulos                           |
| `pnpm --filter api typecheck`        | `tsc --noEmit`                                                  |
| `pnpm --filter api db:generate`      | `drizzle-kit generate`: escreve o SQL da migração em `drizzle/` |
| `pnpm --filter api db:migrate`       | `drizzle-kit migrate`: aplica em `DATABASE_URL` o que falta     |

## Configuração

As variáveis que a API usa hoje são `NODE_ENV`, `PORT` (3333 por padrão),
`DATABASE_URL` (obrigatória), `SUPABASE_JWT_SECRET` (obrigatória, no mínimo 32
caracteres), `CORS_ALLOWED_ORIGINS`, `JOBS_ENABLED`, `LOG_LEVEL` e as três do
Sentry — `SENTRY_DSN`, `SENTRY_ENVIRONMENT` e `SENTRY_RELEASE` (ver "Erros no
Sentry"). Todas estão descritas no [`.env.example`](../../.env.example).

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

A mensagem nunca mostra o valor: a `DATABASE_URL` carrega a senha do banco e a
`SUPABASE_JWT_SECRET` é a chave que assina os tokens, e isso não entra em
terminal nem em log (`CLAUDE.md`, "Saúde e LGPD"). Variável sem valor (`PORT=`)
conta como variável ausente, então o padrão vale.

## `GET /v1/health`

Responde o estado do processo e do banco:

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

## Autenticação

O login é do Supabase Auth; a API só valida o token e identifica quem está
chamando (ADR [0002](../../docs/adr/0002-supabase-como-infraestrutura.md) e
[0007](../../docs/adr/0007-autenticacao-por-jwt-do-supabase.md)). O painel e o
app mandam o access token no cabeçalho:

```
Authorization: Bearer <access token do Supabase>
```

Um **guard global** ([`shared/auth`](./src/shared/auth)) verifica assinatura
(HS256, com a `SUPABASE_JWT_SECRET`), expiração e audiência (`authenticated`), e
exige os claims `sub`, `exp` e `role`. O algoritmo é fixado: sem isso, o header
do próprio token escolheria como ele é verificado. `alg: none` nunca passa.

Sem token, ou com token inválido, expirado, de outro projeto ou de outra
audiência, a resposta é **401**, sempre com o mesmo texto:

```json
{
  "error": {
    "code": "api.http_401",
    "message": "Sessão inválida ou expirada. Entre novamente."
  }
}
```

O motivo não vai para o cliente — a ação dele é a mesma nos quatro casos, e uma
mensagem que distingue os casos é sonda para quem está testando token. Vai para
o log, como código, sem o token nem pedaço dele. Token ausente (`missing`) e
token vencido (`expired`) são tráfego normal e saem em `debug`; os outros
(`signature`, `algorithm`, `audience`, `claims`, `malformed`) são token que não
foi este projeto que emitiu e saem em `warn`, que é o que aparece no CloudWatch
com o `LOG_LEVEL` padrão de produção (`info`).

### `@CurrentUser()`

Numa rota protegida, o controller recebe quem está chamando:

```ts
@Get('me')
me(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponse> {
  return this.loadProfile.execute(user.id);
}
```

São **id e papel, e nada mais**. O token também carrega e-mail e telefone, que
não têm o que fazer circulando pela aplicação. O papel é o claim `role` do token
(`authenticated`, para quem fez login), lido de lá e nunca de `user_metadata`,
que o próprio usuário escreve — o papel de domínio (profissional ou paciente) e
o `professional_type` são do `identity` e entram com o card dele.

Isto é autenticação, não autorização: saber que quem chama é `sub` não é
permissão para ler um paciente. Vínculo ativo, consentimento vigente e tipo de
profissional são checados no caso de uso, pelo serviço de acesso do `identity`,
e dão **403** (`CLAUDE.md`, "Saúde e LGPD").

### `@Public()`

O guard recusa por padrão, então uma rota nova nasce protegida e só abre se
disser:

```ts
@Public()
@Controller({ path: 'health' })
export class HealthController { ... }
```

A assimetria é de propósito: esquecer o `@Public()` numa rota aberta dá 401 e
alguém percebe; o contrário, uma rota de paciente aberta por esquecimento, não
acontece. Hoje a única rota pública é a `GET /v1/health`, que uma sonda do ALB
chama sem sessão. O aceite de convite entra com o `identity`.

O decorator só sabe dizer "abra": no controller ele abre **todas** as rotas
dele, inclusive uma acrescentada depois, e handler nenhum fecha de volta (não
existe `@Public(false)`). Por isso o controller só é marcado quando ele é
público inteiro, como o `HealthController`; rota protegida que cairia num
controller assim ganha um controller próprio.

Rota inexistente continua **404**, com ou sem token: um 401 ali contaria para um
anônimo quais rotas existem. E `@CurrentUser()` numa rota `@Public()` é erro de
fiação, não requisição recusada — sai 500 com o corpo genérico.

## Rotas e versão

O versionamento é por URI, com `defaultVersion: '1'`: todo controller responde
sob `/v1` sem escrever isso no `@Controller`. Uma rota que precise mudar de
forma declara `@Version('2')` sozinha, e o resto continua em `/v1`.

## Identidade: `GET /v1/me` e `POST /v1/professionals/me`

As duas rotas do card **I-01**, as duas sobre **quem está chamando** e nenhuma
sobre outra pessoa: o id é o `sub` do token que o guard global verificou, então
não existe parâmetro para trocar.

### Primeiro acesso

Todo profissional pertence a uma organização, e no MVP cada um ganha a sua, do
tipo `solo`, onde é `owner`. Depois de entrar no Supabase Auth, o painel manda:

```bash
curl -X POST http://127.0.0.1:3333/v1/professionals/me \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Ana Souza","councilNumber":"CRN-3 12345","specialty":"Nutrição esportiva"}'
```

Quatro linhas, numa transação só: `profile` (papel `professional`),
`professional` (tipo, conselho, especialidade), `organization` (`solo`, com o
nome do profissional) e `organization_member` (`owner`). Sem
`professionalType`, o cadastro é de `nutritionist`.

**Idempotente**, e por dois motivos que se somam: o caso de uso lê antes de
escrever, o que resolve o clique duplo e a requisição repetida; e o índice único
em `profile.auth_user_id` resolve a corrida que a leitura não vê — duas
requisições no mesmo instante, em que a segunda não escreve nada e responde o
que a primeira criou. Chamar de novo com dados diferentes **não** sobrescreve:
editar o cadastro é outro caso de uso.

A resposta é **200**, não 201, nas duas chamadas: "criado" não é verdade na
segunda, e os clientes gerados tipam a resposta por status — rota que às vezes
responde 201 é cliente que não sabe ler um dos dois casos.

Conta que já é de paciente recebe **409** (`identity.profile.not_professional`):
este produto não dá dois papéis a uma pessoa.

### Quem está chamando

```bash
curl http://127.0.0.1:3333/v1/me -H "Authorization: Bearer $TOKEN"
```

```json
{
  "personId": "7b4ba3f4-0f64-4e9b-9b20-1e4d6b9f0a21",
  "role": "professional",
  "timeZone": "America/Sao_Paulo",
  "professional": {
    "type": "nutritionist",
    "councilNumber": "CRN-3 12345",
    "specialty": "Nutrição esportiva",
    "organizations": [
      {
        "organizationId": "0e0b0f2a-6a1e-4a66-9b4d-2f0c8f5a7b31",
        "name": "Ana Souza",
        "kind": "solo",
        "role": "owner"
      }
    ]
  }
}
```

`professional` é opcional porque paciente não tem número de conselho nem
organização — campo ausente diz isso melhor do que estrutura vazia que todo
paciente carregaria.

Quem entrou no Auth e **não** concluiu o primeiro acesso não tem perfil, e a
resposta é **404** com `identity.profile.not_found`. Não é erro: é o que leva o
painel à tela de primeiro acesso.

O **nome** de quem chamou não entra na resposta. Ela carrega id e código
(`CLAUDE.md`, "Saúde e LGPD"), e o único texto livre é o nome do consultório da
própria pessoa. Ler o perfil de **outra** pessoa é outro caso de uso, com
vínculo, consentimento e registro de acesso.

### As tabelas

No schema `identity`, e só nele (ADR
[0004](../../docs/adr/0004-um-schema-por-modulo.md)), definidas em
[`identity.schema.ts`](./src/modules/identity/infrastructure/identity.schema.ts):

| Tabela                | O que guarda                                                       |
| --------------------- | ------------------------------------------------------------------ |
| `profile`             | a pessoa: papel, nome, fuso, e o `auth_user_id` do Supabase, único |
| `professional`        | a metade profissional: tipo, número do conselho, especialidade     |
| `organization`        | o consultório ou a clínica                                         |
| `organization_member` | quem pertence a qual organização, e como (`owner`, `member`)       |

O `profile.id` é **nosso**, não o id do Supabase: o login é deles e o domínio é
nosso (ADR [0002](../../docs/adr/0002-supabase-como-infraestrutura.md)), então o
id que os outros schemas vão apontar não muda se o provedor de login mudar. Não
há chave estrangeira para `auth.users` — aquela tabela é do Supabase, não está em
schema deste módulo, e banco de teste não tem Auth dentro.

A decisão está na ADR
[0014](../../docs/adr/0014-modelo-de-identidade-e-organizacao-solo.md).

## Contratos, validação e OpenAPI

Todo DTO é um schema Zod em [`packages/contracts`](../../packages/contracts/README.md)
(`CLAUDE.md`, regra 7). O NestJS 12 lê um Standard Schema, e um schema do Zod 4 é
um — então o mesmo schema valida a entrada, valida a saída e documenta a rota:

```ts
@Get()
@SchemaResponse(meResponseSchema, 'Identidade de quem fez a chamada')
get(): MeResponse {
  return PROVISIONAL_ME;
}

@Post()
create(@Body({ schema: createPlanSchema }) body: CreatePlan) { ... }
```

| Onde                                     | O que acontece                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `@Body`, `@Query`, `@Param` com `schema` | valida a entrada antes do handler; o que sobra não declarado é descartado |
| `SchemaResponse(schema, descrição)`      | documenta a rota no OpenAPI **e** valida a saída                          |

A entrada recusada sai como `400` no envelope de erro de sempre, com o **nome**
dos campos problemáticos e nenhum valor — a mensagem viaja na resposta e o
cliente pode logá-la (`CLAUDE.md`, "Saúde e LGPD"). A saída que não casa com o
schema é `500`: é bug de presenter, e o cliente não vê forma que o contrato não
descreve. E campo que o schema não declara **não** é serializado, o que poda uma
entidade que chegou inteira no presenter.

O documento OpenAPI é lido do app montado, nunca escrito à mão:

```bash
pnpm api:generate     # na raiz: escreve o openapi.json e regera os clientes
```

[`openapi.json`](./openapi.json) é versionado — é dele que saem os clientes
(TypeScript e Dart), então mudança de contrato aparece como diff no PR. A página
interativa fica em [`/docs`](http://127.0.0.1:3333/docs) **fora de produção**; em
produção ela não existe, porque é o mapa inteiro da API em uma página.

## Eventos entre módulos

Um módulo não importa código de outro (`CLAUDE.md`, regra 1) nem lê a tabela
dele (regra 2). Quando um fato de um importa para o outro, ele é anunciado
(regra 3, ADR [0009](../../docs/adr/0009-eventos-internos-e-fila-de-jobs.md)).

O nome e o payload de todo evento estão num catálogo só,
[`shared/events/domain-event.ts`](./src/shared/events/domain-event.ts), no
formato `<modulo>.<entidade>.<fato no passado>`. Quem publica pede a porta:

```ts
constructor(@Inject(EVENT_BUS) private readonly events: EventBusPort) {}

await this.events.publish('nutrition.plan.activated', { planId, patientId, activatedAt });
```

Quem reage assina uma vez, quando o módulo sobe:

```ts
@Injectable()
export class ReviewAlertRulesListener implements OnApplicationBootstrap {
  constructor(@Inject(EVENT_BUS) private readonly events: EventBusPort) {}

  onApplicationBootstrap(): void {
    this.events.subscribe('nutrition.plan.activated', ({ patientId }) =>
      this.reviewRules.execute(patientId),
    );
  }
}
```

O barramento é **em memória**: publicar é uma chamada de função no mesmo
processo. Ele espera os handlers — o que mantém legível a ordem do que acontece
— e um handler que estoura vira linha de log, nunca exceção subindo para quem
publicou. Por isso handler é curto: o que for lento ou precisar de nova
tentativa vira job.

O payload carrega **id e código, nunca dado de saúde ou pessoal**. Quem precisa
do dado por trás do id pede ao módulo dono, com a checagem de consentimento que
vem junto.

## Jobs em fila

Trabalho que não cabe dentro de uma requisição — lento, dependente de servidor
de terceiro, agendado, ou que precisa ser tentado de novo — vai para a fila. É
o **pg-boss**, no mesmo Postgres, no schema `pgboss` (ADR 0009).

Um job é um provider que diz o próprio nome, a política de tentativas e, se for
o caso, o cron — e se registra quando a aplicação sobe:

```ts
@Injectable()
export class PingJob implements JobDefinition<'ping'>, OnApplicationBootstrap {
  readonly name = 'ping';
  readonly retry: JobRetryPolicy = {
    maxAttempts: 3,
    firstRetryDelaySeconds: 10,
    backoff: 'exponential',
    maxRetryDelaySeconds: 300,
  };
  readonly schedule: JobSchedule<'ping'> = { cron: '*/15 * * * *', payload: {} };

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.register(this);
  }

  async handle(): Promise<void> { ... }
}
```

Enfileirar sob demanda é `await this.queue.enqueue('ping', {})`.

Duas coisas que o autor do job precisa saber:

- **Estourar é como o job reporta falha.** É a exceção que faz a fila contar a
  tentativa e esperar o backoff antes da próxima. Job que engole o próprio erro
  é job que silenciosamente não aconteceu.
- **Rodar duas vezes tem que ser seguro.** O mesmo payload chega de novo depois
  de uma falha, e não pode cobrar duas vezes nem mandar dois e-mails.

O payload também é só id e código: ele fica gravado numa tabela até o worker
pegá-lo.

`JOBS_ENABLED=false` troca a fila por uma que não faz nada. É o padrão em
teste, e é o que o `pnpm api:generate` usa, porque ali a aplicação sobe só para
ter as rotas lidas. O `ping` é o exemplo do card F-10: roda a cada quinze
minutos e só escreve uma linha, que é o jeito mais barato de ver se os workers
daquela task estão de pé.

## Estrutura

```
src/
  instrument.ts      o primeiro import do main.ts: lê o .env e liga o Sentry antes de tudo
  main.ts            bootstrap: valida o ambiente, cria o app, escuta a porta
  bootstrap.ts       versionamento, validação, CORS e /docs — o mesmo que o teste e2e usa
  app.module.ts      composition root: os 4 módulos, o health check, o filtro de erros
  openapi.ts         monta o documento OpenAPI e serve o /docs
  write-openapi.ts   escreve o openapi.json (é o `openapi:write`)
  modules/           os módulos de domínio (ver modules/README.md)
  health-check/      o GET /v1/health, em quatro camadas. É o exemplo a copiar
  shared/            o que atravessa módulo: env, logger, auth, pool do Postgres, eventos, fila de jobs, erros de domínio
    testing/         o Postgres descartável dos testes de integração (não vai para a imagem)
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

Fora dessa tabela há um 401, que não é erro de domínio: é o guard de
autenticação recusando a requisição antes de qualquer caso de uso (ver
"Autenticação").

O corpo é sempre o mesmo, e o `code` é a chave de i18n do cliente:

```json
{ "error": { "code": "nutrition.plan.not_found", "message": "Plano não encontrado." } }
```

Erro inesperado vira 500 com mensagem genérica. O log fica com o nome do erro e
a pilha **sem a primeira linha**: a mensagem do driver pode citar o valor de uma
coluna, e dado pessoal não entra em log (`CLAUDE.md`, "Saúde e LGPD"). Esse — e
só esse — também vai para o Sentry (ver "Erros no Sentry").

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
[`@fit-app/observability`](../../packages/observability/README.md), porque o
filtro do Sentry usa a mesma: campo que é dado pessoal em linha de log é dado
pessoal em relatório de erro.

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

## Erros no Sentry

Erro inesperado vai para o log **e** para o Sentry (ADR
[0013](../../docs/adr/0013-sentry-nos-tres-apps.md)). Só o inesperado: 404, 403
e 422 são respostas que a API dá de propósito, e mandá-las afogaria a falha de
verdade.

Três variáveis, e elas andam juntas. Sem `SENTRY_DSN` a API não reporta nada —
o erro fica no log, que é o que um notebook e o CI querem. Com DSN,
`SENTRY_RELEASE` passa a ser **obrigatória** (a tag da imagem ou o sha do
commit): evento que não diz a versão não responde se o bug ainda está no ar. O
`SENTRY_ENVIRONMENT` tem padrão `NODE_ENV`, e existe porque a task de
homologação roda com `NODE_ENV=production` e precisa aparecer como `staging`.

O que sai no evento, e por quê, está em
[`@fit-app/observability`](../../packages/observability/README.md): o usuário é
**só um id**, a requisição fica em método e caminho, texto livre vira
`[redacted]`, e `extra`, `contexts` e `tags` passam pela mesma máscara do log. A
outra metade é o que o SDK nem chega a coletar — corpo, cookie, cabeçalho, query
string, parâmetro de query do banco, variável local de quadro de pilha —, que
está em [`shared/observability/sentry.ts`](./src/shared/observability/sentry.ts).
Cada evento leva o `correlationId` como tag: é o que liga a issue do Sentry à
linha no CloudWatch.

### Conferir que está chegando

Fora de produção existe `GET /v1/debug/sentry`, que estoura de propósito (em
produção ela responde 404, e ela nunca entra no OpenAPI):

```bash
SENTRY_DSN=... SENTRY_RELEASE=api@local pnpm --filter api dev
curl -i http://127.0.0.1:3333/v1/debug/sentry   # 500 com o envelope genérico
```

A issue aparece no projeto em segundos, e o que ela **não** tem é metade do
teste: a mensagem do erro traz um nome e um e-mail sintéticos, e na issue os
dois saem como `[redacted]`. A outra metade é automática, em
[`shared/observability/sentry.spec.ts`](./src/shared/observability/sentry.spec.ts),
que lê o envelope que o transporte receberia.

## Testes

São dois perfis, e a diferença entre eles é uma só: se o teste precisa de banco.

```bash
pnpm test:unit          # na raiz, via turbo: rápido, sem Docker
pnpm test:integration   # sobe um Postgres descartável no Docker
```

| Perfil             | Arquivos                | Precisa de Docker | Config                                                         |
| ------------------ | ----------------------- | ----------------- | -------------------------------------------------------------- |
| `test:unit`        | `*.spec.ts`             | não               | [`jest.unit.config.mjs`](./jest.unit.config.mjs)               |
| `test:integration` | `*.integration-spec.ts` | sim               | [`jest.integration.config.mjs`](./jest.integration.config.mjs) |

O que os dois compartilham (o transform do ts-jest, o `rootDir`, a emissão em
ES modules) está em [`jest.base.config.mjs`](./jest.base.config.mjs), que não
nomeia teste nenhum de propósito: o perfil é só a lista de arquivos que ele lê.
E o sufixo é o que separa os dois — `\.spec\.ts$` exige o ponto literal antes de
`spec`, então um teste que quer banco não entra na rodada que não tem banco.

`pnpm --filter api test` continua existindo e é apelido de `test:unit`: o que
roda em todo push não depende de Docker.

### O perfil rápido

Os testes de unidade moram ao lado do código, em `*.spec.ts`, e `health-check`
tem um exemplo de cada camada — a tabela está em
[`src/modules/README.md`](./src/modules/README.md). Nada aqui precisa de banco
no ar: os testes de ponta a ponta sobem o `AppModule` de verdade e trocam só o
que não pode subir num teste — o ambiente, a porta do banco e, no teste de
correlation id, o logger, que passa a escrever num stream que o teste lê.

Teste de `domain/` é obrigatório (`CLAUDE.md`, "Testes") e vive aqui: regra pura
não tem o que fazer esperando um contêiner.

Os tokens dos testes de autenticação são assinados no próprio processo de
teste, com um segredo de teste
([`local-access-token.spec-support.ts`](./src/shared/auth/local-access-token.spec-support.ts)).
O segredo do Supabase é simétrico, então um token assinado com o mesmo segredo
que o verificador recebeu é igual ao que o Supabase emitiria — e é o único jeito
de ter em mãos um token expirado, forjado ou de outra audiência. O arquivo não é
`.spec.ts` (o jest não o lê como suíte) e está fora do `tsconfig.build.json`:
assinador de token não vai para a imagem.

### O Postgres descartável

Caso de uso que lê e escreve dado de paciente é testado contra Postgres de
verdade, com Testcontainers (`CLAUDE.md`, "Testes"): metade do que esses casos
de uso garantem está escrita em SQL — um unique, um check, um cascade, "um plano
ativo por paciente" — e repositório falso responde pelo código e deixa a metade
do banco sem teste.

O `globalSetup` do perfil sobe **um** contêiner para a rodada inteira, aplica
nele as migrações de `drizzle/` e publica a string de conexão; o
`globalTeardown` descarta o contêiner no fim. Está tudo em
[`src/shared/testing`](./src/shared/testing/integration-postgres.spec-support.ts):

| Passo    | O que acontece                                                                  |
| -------- | ------------------------------------------------------------------------------- |
| sobe     | `postgres:17-alpine`, o mesmo major do Supabase local e dos projetos hospedados |
| migra    | as migrações de `drizzle/`, com a mesma tabela de controle do `pnpm db:migrate` |
| testa    | as suítes, uma por vez (`maxWorkers: 1`): o banco é um só                       |
| descarta | o contêiner morre e os dados com ele                                            |

Banco descartável é o ponto: a rodada não herda linha da anterior, não precisa
limpar nada depois de si e não deixa nada para trás. O que entrou nele era dado
**sintético** — dado real de paciente não entra em desenvolvimento nem em teste
(`CLAUDE.md`, "Testes"), e o gerador de pacientes sintéticos é o dos
[`scripts/`](../../scripts/README.md) (card F-15).

A pasta, a tabela de controle e o schema dela vêm de
[`shared/database/migrations.ts`](./src/shared/database/migrations.ts), que o
Drizzle Kit e o harness leem: banco de teste montado com controle diferente do
banco de verdade não é o banco de verdade.

A primeira migração é a do card I-01, que cria o schema `identity` e as quatro
tabelas dele. Migração nova entra com `pnpm db:generate`, é revisada no PR, e o
harness passa a aplicá-la sem mudança nenhuma aqui.

Um teste de integração pede a conexão ao harness, nunca à `DATABASE_URL` (essa é
a da API e a do `db:migrate`):

```ts
import { integrationDatabaseUrl } from '../testing/integration-postgres.spec-support';

const pool = new Pool({ connectionString: integrationDatabaseUrl() });
```

Fora do perfil de integração a função estoura com a frase que diz qual comando
rodar — teste que caísse em outro banco seria teste escrevendo onde ninguém
olha.

O exemplo a copiar é
[`pg-boss-job-queue.integration-spec.ts`](./src/shared/jobs/pg-boss-job-queue.integration-spec.ts):
o teste de unidade do adaptador o guia com um cliente que o próprio teste
escreveu, e prova o que o adaptador **pede** ao pg-boss; o de integração prova
que o pg-boss **responde** — a fila é criada, o worker roda o job e as tabelas
caem no schema `pgboss` e em nenhum outro.

### Fábricas

As fábricas que o card F-11 pede — criar profissional, paciente, vínculo e
consentimento numa linha — **ainda não existem**. O card I-01 trouxe as tabelas
de profissional e organização, e com elas o caminho do profissional já tem um
jeito de ser montado: o próprio caso de uso de cadastro, que é o que
[`register-professional.use-case.integration-spec.ts`](./src/modules/identity/application/register-professional.use-case.integration-spec.ts)
usa. Paciente, vínculo e consentimento continuam sem tabela, e fábrica é código
de `insert`: sem coluna, não há o que inserir.

Quando elas entrarem, é aqui que moram (`src/shared/testing`), com o sufixo
`.spec-support.ts` e três regras que já valem:

- **Dado sintético, sempre.** Nome, e-mail e valor de check-in saem do gerador
  dos [`scripts/`](../../scripts/README.md) (card F-15), nunca de paciente real.
- **Consentimento é parte do cenário.** Profissional só vê paciente com vínculo
  ativo **e** consentimento `share_with_professional` vigente, então a fábrica
  cria o consentimento explicitamente: um teste que passa por esquecer o
  consentimento é um teste que aprova um furo de LGPD.
- **Nada de fábrica na imagem.** `.spec-support.ts` está fora do
  `tsconfig.build.json`, como o assinador de token.

### Como o jest roda

O jest roda com `--experimental-vm-modules` e compila os testes como ES modules
(`tsconfig.spec.json`). O motivo é o NestJS 12, que é publicado só como ESM:
`require` de ESM dentro do jest só funciona a partir do Node 24.9, e assim os
testes rodam em qualquer Node 24. A aplicação continua compilando como
CommonJS.
