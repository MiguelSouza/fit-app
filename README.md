# fit-app

Plataforma para nutricionistas esportivos que prescrevem a dieta e acompanham o paciente
num só lugar, cruzando alimentação, treino, sono e sintomas para mostrar **quem precisa de
atenção e por quê**.

Antes de escrever qualquer código, leia o [`CLAUDE.md`](./CLAUDE.md): ele manda sobre
arquitetura, fronteiras de módulo, LGPD e convenções.

## Pré-requisitos

| Ferramenta | Versão                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| Node       | 24 LTS (ver [`.nvmrc`](./.nvmrc) — `nvm use`)                           |
| pnpm       | 12 (`corepack enable` usa a versão fixada em `packageManager`)          |
| Docker     | Engine 24+ com Compose, rodando (no Windows e no macOS, Docker Desktop) |
| Flutter    | 3.47+, só para `apps/mobile` (o `flutter doctor` diz o que falta)       |

O **Supabase CLI não precisa de instalação global**: é uma devDependency da raiz,
então o `pnpm install` já o traz na versão que o repositório inteiro usa. Chame-o
pelos scripts `db:*` ou, para um comando solto, com `pnpm exec supabase <...>`.

## Do zero ao banco rodando

Depois do `git clone`, três comandos:

```bash
pnpm install           # workspace, Supabase CLI e hooks de git
cp .env.example .env   # no PowerShell: Copy-Item .env.example .env
pnpm db:start          # sobe Postgres, Auth e Storage no Docker
```

O primeiro `db:start` baixa as imagens do Docker e leva alguns minutos; os
seguintes sobem em segundos. No fim ele imprime as URLs e o par de chaves novo
do Supabase (`Publishable` e `Secret`), que ainda não usamos.

As três chaves que o `.env` pede saem do `status` em formato de ambiente:

```bash
pnpm exec supabase status -o env   # ANON_KEY, SERVICE_ROLE_KEY, JWT_SECRET
```

Copie as três para o seu `.env`; a mesma chave `anon` vale para
`NEXT_PUBLIC_SUPABASE_ANON_KEY` e para `FLUTTER_SUPABASE_ANON_KEY`. A
`SUPABASE_JWT_SECRET` é obrigatória: é com ela que a API verifica o token de
quem chama, e sem ela a API não sobe.

O `status` só responde com o stack de pé: depois de um `db:stop` ele falha com
`No such container`. Os valores, porém, não mudam de um start para o outro —
pegue uma vez e pronto.

As chaves locais são geradas a partir de um segredo fixo e público do Supabase
CLI, iguais em toda máquina: não são segredo e não servem para nada fora do seu
Docker. Mesmo assim o `.env` é ignorado pelo git — não há exceção.

## Banco, autenticação e arquivos locais

O ambiente local é o Supabase CLI, configurado em
[`supabase/`](./supabase/README.md), rodando a mesma trinca que usamos em
produção: Postgres, Auth e Storage.

| Script             | O que faz                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `pnpm db:start`    | sobe os contêineres e imprime URLs e chaves                                               |
| `pnpm db:stop`     | derruba os contêineres; o volume de dados fica, então o próximo start reaproveita         |
| `pnpm db:reset`    | recria o banco do zero: roda as migrações e depois o `supabase/seed.sql`                  |
| `pnpm db:generate` | gera o SQL da migração a partir dos arquivos de schema do Drizzle, em `apps/api/drizzle/` |
| `pnpm db:migrate`  | aplica no banco local as migrações do Drizzle que ainda faltam                            |

O `db:reset` é do Supabase CLI e não conhece as migrações do Drizzle: ele recria
o banco e apaga os schemas de domínio. Depois de um reset, rode `pnpm db:migrate`
para tê-los de volta — nessa ordem, sempre.

Portas (todas em `127.0.0.1`, definidas no `supabase/config.toml`):

| Porta   | Serviço                                                         |
| ------- | --------------------------------------------------------------- |
| `54321` | API do Supabase — é por onde Auth e Storage respondem           |
| `54322` | Postgres (`postgresql://postgres:postgres@127.0.0.1:54322`)     |
| `54323` | Studio, para olhar o banco pelo navegador                       |
| `54324` | caixa de e-mail de teste (Mailpit): o que o Auth manda cai aqui |

Em **produção** o banco não é esse: são dois projetos Supabase hospedados
(staging e produção) na região de **São Paulo**, ao lado da API na AWS
**`sa-east-1`** — ver [ADR 0002](./docs/adr/0002-supabase-como-infraestrutura.md)
e [ADR 0005](./docs/adr/0005-aws-sa-east-1-e-vercel.md). Nada aponta para eles a
partir da sua máquina, e **dado real de paciente nunca entra em desenvolvimento
ou teste**: os dados são sintéticos, gerados pelos scripts em
[`scripts/`](./scripts/README.md).

## Variáveis de ambiente

[`.env.example`](./.env.example) lista todas as variáveis da API, do painel e do
app, sem nenhum valor real, e diz de qual card cada bloco é. É o arquivo que se
copia para `.env`.

Nenhum segredo entra no repositório. O `.gitignore` barra `.env` e `.env.*`, com
`.env.example` como única exceção. Em staging e produção os valores vivem no AWS
Secrets Manager (`sa-east-1`) e nas variáveis de ambiente da Vercel.

## Como rodar

```bash
pnpm install          # instala todo o workspace
pnpm dev              # sobe tudo em modo de desenvolvimento
pnpm build            # build de todos os pacotes
pnpm lint             # lint
pnpm typecheck        # checagem de tipos
pnpm test             # testes (o perfil rápido de cada workspace)
pnpm test:unit        # os testes que não precisam de banco
pnpm test:integration # os testes contra um Postgres descartável (precisa de Docker)
pnpm format           # formata o repositório com o prettier compartilhado
pnpm format:check     # só verifica a formatação, sem reescrever nada
pnpm api:generate     # regera o OpenAPI da API e os clientes TypeScript e Dart
pnpm seed:synthetic   # gera pacientes sintéticos (--patients 20, --help)
```

Quase todo script da raiz delega ao turbo. As exceções são os `db:*` da seção
anterior e o `seed:synthetic`, que chamam direto quem faz o trabalho. Para
rodar em um pacote só, use o filtro:

```bash
pnpm turbo run build --filter=@fit-app/api
pnpm turbo run test  --filter=@fit-app/contracts
```

`format` e `format:check` não passam pelo turbo: o prettier varre o repositório
inteiro de uma vez, a partir do [`prettier.config.mjs`](./prettier.config.mjs) da
raiz. O lint e a checagem de tipos são por workspace, e cada um herda as regras de
[`@fit-app/config`](./packages/config/README.md). `pnpm lint` roda o turbo e
depois o `lint:root`, que cobre os arquivos de configuração da própria raiz —
eles não pertencem a nenhum workspace e ficariam de fora.

Os testes são dois perfis: o `test:unit` precisa só do Node, e o
`test:integration` sobe um Postgres descartável no Docker, migra, testa e
descarta. `pnpm test` roda o perfil rápido de cada workspace, que é o que vale
em todo push. Os detalhes estão no
[README de `apps/api`](./apps/api/README.md#testes).

## Contratos e clientes gerados

Todo DTO nasce como schema Zod em
[`packages/contracts`](./packages/contracts/README.md) (`CLAUDE.md`, regra 7). A
API valida entrada e saída contra esses schemas, e o resto é gerado:

```
packages/contracts  ──▶  apps/api/openapi.json  ──▶  packages/api-client (TypeScript)
   (schemas Zod)           (gerado pela API)     └─▶  apps/mobile/packages/api_client (Dart)
```

```bash
pnpm api:generate     # os três passos, nesta ordem
```

Mudou um schema? Rode isso e comite o `openapi.json` junto: ele é versionado, de
propósito, para o painel e o app compilarem sem subir a API e para a mudança de
contrato aparecer como diff no PR. Quem usava o campo antigo deixa de compilar —
é esse o ponto. Os detalhes estão no
[ADR 0008](./docs/adr/0008-contratos-em-zod-e-clientes-gerados.md).

O cliente Dart é gerado em Docker (`openapi-generator`) e **não** é versionado:
ele só compila depois do `build_runner`, que roda dentro de `apps/mobile` — o
passo a passo está no [README do app](./apps/mobile/README.md#antes-da-primeira-vez).

A documentação interativa da API fica em
[`/docs`](http://127.0.0.1:3333/docs) com a API local de pé — e não existe em
produção.

## O que roda no commit

`pnpm install` instala os hooks do git (husky, em [`.husky/`](./.husky)). A partir
daí todo commit passa por dois portões:

| Hook         | O que faz                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `pre-commit` | `lint-staged`: eslint `--fix` e prettier, só nos arquivos em stage                               |
| `commit-msg` | `commitlint`: a mensagem tem de ser [Conventional Commits](https://www.conventionalcommits.org/) |

Nada disso substitui `pnpm lint` e `pnpm typecheck` — o hook só vê o que está em
stage. Para um commit de emergência, `git commit --no-verify` pula os dois, e aí
[o CI é quem pega](#o-que-roda-no-ci).

O app do paciente não passa pelo turbo — é Flutter, e o que vale nele é
`flutter analyze` e `flutter test`, rodados à mão:

```bash
cd apps/mobile && flutter analyze && flutter test
```

Rodar o app pede os `--dart-define` de ambiente; a linha de comando pronta, para
o emulador Android e para o simulador iOS, está no
[README de `apps/mobile`](./apps/mobile/README.md#como-rodar).

## O que roda no CI

Em todo PR e em todo push na `main`, o GitHub Actions roda
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml): um job só, chamado
`ci`, com os passos nesta ordem.

| Passo                     | Comando                                      |
| ------------------------- | -------------------------------------------- |
| Install                   | `pnpm install --frozen-lockfile`             |
| Lint                      | `pnpm turbo run lint --affected`             |
| Lint dos arquivos da raiz | `pnpm lint:root`                             |
| Formatação                | `pnpm format:check`                          |
| Typecheck                 | `pnpm turbo run typecheck --affected`        |
| Testes unitários          | `pnpm turbo run test:unit --affected`        |
| Testes de integração      | `pnpm turbo run test:integration --affected` |
| Build                     | `pnpm turbo run build --affected`            |

É a mesma lista que o [Como rodar](#como-rodar) manda rodar antes de empurrar, e
nenhum passo é tolerante: o primeiro que falhar reprova o job e deixa o check
`ci` vermelho.

O Node sai do [`.nvmrc`](./.nvmrc) e o pnpm do `packageManager` do
`package.json`, os mesmos arquivos que valem na sua máquina — não há uma segunda
lista de versões para esquecer de atualizar. O cache é o _store_ do pnpm, com
chave no `pnpm-lock.yaml`.

`--affected` é o Turborepo rodando **só o que mudou**: os pacotes alterados
entre a `main` e a branch, mais os que dependem deles. Mudança no `turbo.json`,
no `package.json` da raiz ou no lockfile seleciona tudo, e `packages/config` é
dependência de todos, então mexer nas regras compartilhadas também. Os dois
passos sem `--affected` são os que o turbo não tem como estreitar: o
`lint:root`, dos arquivos de configuração da raiz e dos scripts em `.archon/`,
que não pertencem a workspace nenhum, e o `format:check`, que o prettier roda no
repositório inteiro.

Os testes de integração usam o Docker do próprio runner, sem passo de
preparação. O job tem `timeout-minutes: 10`, que é o orçamento do card F-12
escrito como limite: um CI que passar de dez minutos falha em vez de virar o
novo normal em silêncio.

Fora do CI ficam `apps/mobile` (é Flutter e precisa do SDK, então `flutter
analyze` e `flutter test` são de quem empurra),
`pnpm test:archon` (roda no `bun`, e é ferramenta do Archon) e qualquer deploy.
O workflow só lê o repositório: `permissions: contents: read`, nenhum segredo.
O porquê de cada escolha está no
[ADR 0010](./docs/adr/0010-ci-no-github-actions.md).

## Proteção da `main`

A `main` não aceita push direto, de ninguém: toda mudança entra por PR, e o PR
só pode ser mesclado com o check `ci` verde. Não é preciso aprovação de
ninguém — o repositório tem um mantenedor, e o GitHub não deixa aprovar o
próprio PR —, mas o PR é obrigatório. _Force push_ e remoção da branch estão
bloqueados.

Isso é configuração do GitHub, não arquivo do repositório: não aparece em diff
de PR e não volta com `git revert`. Para ver como está:

```bash
gh api repos/MiguelSouza/fit-app/branches/main/protection
```

> [!IMPORTANT]
> O check obrigatório se chama **`ci`**, que é o id do job no `ci.yml`.
> Renomear o job sem atualizar a proteção faz o check obrigatório parar de
> reportar, e aí todo PR fica travado em "esperando" — não vermelho, travado.
> Mudou o nome? Atualize os dois.

Para um reparo de emergência direto na `main`, o caminho é desligar o
`enforce_admins`, fazer o que tem de ser feito e religar na mesma hora:

```bash
gh api -X DELETE repos/MiguelSouza/fit-app/branches/main/protection/enforce_admins
# ... o reparo ...
gh api -X POST   repos/MiguelSouza/fit-app/branches/main/protection/enforce_admins
```

## Estrutura

```
apps/
  api/            NestJS                                    @fit-app/api
  web/            Next.js (painel do profissional)          @fit-app/web
  mobile/         Flutter (app do paciente)                 fora do workspace pnpm
packages/
  contracts/      schemas Zod, tipos e enums compartilhados @fit-app/contracts
  api-client/     cliente TypeScript gerado do OpenAPI      @fit-app/api-client
  config/         eslint, tsconfig, prettier compartilhados @fit-app/config
  observability/  o que nunca sai num log nem num evento    @fit-app/observability
infra/            AWS CDK                                   @fit-app/infra
docs/adr/         registros de decisão de arquitetura
scripts/          seeds, pacientes sintéticos, TACO/TBCA    @fit-app/scripts
```

## Estado atual

O esqueleto do monorepo (card **F-01**), a configuração compartilhada de eslint, tsconfig
e prettier (card **F-03**, em `packages/config`) e o ambiente local com Docker e Supabase
CLI (card **F-04**, em `supabase/`) já estão de pé. O esqueleto da API (card **F-05**, em
`apps/api`) também: NestJS com os quatro módulos de domínio, tratamento global de erros e
`GET /v1/health` — `pnpm --filter api dev` sobe a API em
[http://127.0.0.1:3333](http://127.0.0.1:3333), e o
[README de `apps/api`](./apps/api/README.md) tem o resto. Os contratos (card **F-09**)
também: `packages/contracts` com os schemas Zod, o `openapi.json` gerado pela API, o
`/docs` fora de produção e os clientes gerados em `packages/api-client` (TypeScript) e
para o app (Dart). E o encanamento interno da API (card **F-10**): barramento de eventos
entre módulos e fila de jobs com pg-boss, cada um atrás de uma porta — ver
[ADR 0009](./docs/adr/0009-eventos-internos-e-fila-de-jobs.md). E os dois perfis de teste
(card **F-11**): `pnpm test:unit` sem Docker e `pnpm test:integration` num Postgres
descartável; as fábricas de profissional, paciente, vínculo e consentimento esperam as
tabelas de `identity`, que são o que falta do card **F-07**. E o CI (card **F-12**):
o [`ci.yml`](./.github/workflows/ci.yml) roda lint, typecheck, os dois perfis de teste e
o build em todo PR e em todo push na `main`, com o turbo rodando só o que mudou, e a
`main` só aceita PR com esse check verde — ver
[ADR 0010](./docs/adr/0010-ci-no-github-actions.md). E o esqueleto do painel (card
**F-13**, em `apps/web`): Next.js 16 com App Router, Tailwind 4 e shadcn/ui, login com
Supabase Auth (entrar, sair e recuperar a senha), rotas protegidas e o menu com Fila,
Pacientes, Convites e Ajustes — `pnpm --filter @fit-app/web dev` sobe o painel em
[http://127.0.0.1:3000](http://127.0.0.1:3000), e o
[README de `apps/web`](./apps/web/README.md) tem o resto, incluindo um ponto que ainda não
fecha entre a sessão do painel e o guard da API. A sessão fica em cookie, para o servidor
poder lê-la — ver [ADR 0011](./docs/adr/0011-sessao-do-painel-em-cookie.md). E o esqueleto
do app do paciente (card **F-14**, em `apps/mobile`): Flutter com Riverpod e go_router,
login e logout com Supabase Auth, tema escuro montado de tokens de cor e tipografia, os
três ambientes por `--dart-define` e uma tela inicial protegida que mostra o
`GET /v1/me` — o [README de `apps/mobile`](./apps/mobile/README.md) tem os comandos, e o
[ADR 0012](./docs/adr/0012-esqueleto-do-app-do-paciente.md) o porquê de cada escolha.
Ele herda o mesmo ponto aberto do painel: entrar e sair funcionam, e a chamada à API com
a sessão real ainda responde 401.
E o gerador de pacientes sintéticos (card **F-15**, em `scripts/`):
`pnpm seed:synthetic --patients 20` cria uma organização, uma nutricionista e N pacientes
com 90 dias de atividades, sono, métricas diárias, check-ins, peso e adesão, em seis
perfis prontos — estável, sobrecarga, perda de peso não planejada, adesão em queda,
sumiu e energia baixa — a partir de uma semente fixa, e imprime no fim a tabela que diz
quem precisa de atenção e por quê. Nomes e e-mails são inventados, o domínio é
`.invalid` e não há documento nem telefone: nenhum dado real de paciente entra em
desenvolvimento ou teste. A saída é json em `scripts/.synthetic`, não linhas no banco —
escrever no Postgres espera as tabelas que faltam do **F-07**, como explica o
[README de `scripts/`](./scripts/README.md).
E os erros nos três apps (card **F-16**): Sentry na API, no painel e no app, cada um com
ambiente e versão, o usuário identificado **só por id** e um `beforeSend` que tira do
evento nome, e-mail, telefone, nota e valor de check-in — o mesmo filtro e a mesma lista
de campos do log, agora em `packages/observability`, com um gêmeo em Dart dentro do app.
Sem DSN ninguém reporta nada, que é o padrão em desenvolvimento; os três têm um jeito
fora de produção de provocar um erro e conferir o que chega. O porquê de cada escolha
está no [ADR 0013](./docs/adr/0013-sentry-nos-tres-apps.md).
Os demais pacotes seguem como placeholders, com scripts no-op para o `turbo` ter o que
percorrer; o conteúdo real de cada um entra pelos cards indicados no `README.md` de cada
pasta.

## Fluxo de trabalho

O trabalho é organizado no quadro Trello **Wellness**. Um card = uma branch = um PR,
nomeada com o ID do card (`feat/F-01-monorepo-turborepo`), commits em
[Conventional Commits](https://www.conventionalcommits.org/). Quem abre o PR não faz
merge, e [a `main` não deixa](#proteção-da-main) de outro jeito. Detalhes no card
"LEIA PRIMEIRO".
