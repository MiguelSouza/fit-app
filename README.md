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
| Flutter    | só para `apps/mobile` (ver card F-14)                                   |

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
seguintes sobem em segundos. No fim ele imprime as URLs e as chaves locais —
copie `anon key`, `service_role key` e `JWT secret` para o seu `.env`
(`pnpm exec supabase status` imprime de novo quando precisar).

As chaves locais são geradas a partir de um segredo fixo e público do Supabase
CLI, iguais em toda máquina: não são segredo e não servem para nada fora do seu
Docker. Mesmo assim o `.env` é ignorado pelo git — não há exceção.

## Banco, autenticação e arquivos locais

O ambiente local é o Supabase CLI, configurado em
[`supabase/`](./supabase/README.md), rodando a mesma trinca que usamos em
produção: Postgres, Auth e Storage.

| Script          | O que faz                                                                         |
| --------------- | --------------------------------------------------------------------------------- |
| `pnpm db:start` | sobe os contêineres e imprime URLs e chaves                                       |
| `pnpm db:stop`  | derruba os contêineres; o volume de dados fica, então o próximo start reaproveita |
| `pnpm db:reset` | recria o banco do zero: roda as migrações e depois o `supabase/seed.sql`          |

Portas (todas em `127.0.0.1`, definidas no `supabase/config.toml`):

| Porta   | Serviço                                                     |
| ------- | ----------------------------------------------------------- |
| `54321` | API do Supabase — é por onde Auth e Storage respondem       |
| `54322` | Postgres (`postgresql://postgres:postgres@127.0.0.1:54322`) |
| `54323` | Studio, para olhar o banco pelo navegador                   |
| `54324` | caixa de e-mail de teste: tudo que o Auth manda cai aqui    |

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
pnpm test             # testes
pnpm format           # formata o repositório com o prettier compartilhado
pnpm format:check     # só verifica a formatação, sem reescrever nada
```

Cada script da raiz delega ao turbo. Para rodar em um pacote só, use o filtro:

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

## O que roda no commit

`pnpm install` instala os hooks do git (husky, em [`.husky/`](./.husky)). A partir
daí todo commit passa por dois portões:

| Hook         | O que faz                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `pre-commit` | `lint-staged`: eslint `--fix` e prettier, só nos arquivos em stage                               |
| `commit-msg` | `commitlint`: a mensagem tem de ser [Conventional Commits](https://www.conventionalcommits.org/) |

Nada disso substitui `pnpm lint` e `pnpm typecheck` — o hook só vê o que está em
stage. Para um commit de emergência, `git commit --no-verify` pula os dois, e aí
o CI é quem pega.

O app do paciente não passa pelo turbo — é Flutter:

```bash
cd apps/mobile && flutter pub get && flutter run
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
infra/            AWS CDK                                   @fit-app/infra
docs/adr/         registros de decisão de arquitetura
scripts/          seeds, pacientes sintéticos, TACO/TBCA    @fit-app/scripts
```

## Estado atual

O esqueleto do monorepo (card **F-01**), a configuração compartilhada de eslint, tsconfig
e prettier (card **F-03**, em `packages/config`) e o ambiente local com Docker e Supabase
CLI (card **F-04**, em `supabase/`) já estão de pé. Os demais pacotes seguem
como placeholders, com scripts no-op para o `turbo` ter o que percorrer; o conteúdo real de
cada um entra pelos cards indicados no `README.md` de cada pasta.

## Fluxo de trabalho

O trabalho é organizado no quadro Trello **Wellness**. Um card = uma branch = um PR,
nomeada com o ID do card (`feat/F-01-monorepo-turborepo`), commits em
[Conventional Commits](https://www.conventionalcommits.org/). Quem abre o PR não faz
merge. Detalhes no card "LEIA PRIMEIRO".
