# fit-app

Plataforma para nutricionistas esportivos que prescrevem a dieta e acompanham o paciente
num só lugar, cruzando alimentação, treino, sono e sintomas para mostrar **quem precisa de
atenção e por quê**.

Antes de escrever qualquer código, leia o [`CLAUDE.md`](./CLAUDE.md): ele manda sobre
arquitetura, fronteiras de módulo, LGPD e convenções.

## Pré-requisitos

| Ferramenta | Versão                                                         |
| ---------- | -------------------------------------------------------------- |
| Node       | 24 LTS (ver [`.nvmrc`](./.nvmrc) — `nvm use`)                  |
| pnpm       | 12 (`corepack enable` usa a versão fixada em `packageManager`) |
| Flutter    | só para `apps/mobile` (ver card F-14)                          |

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

O esqueleto do monorepo (card **F-01**) e a configuração compartilhada de eslint, tsconfig
e prettier (card **F-03**, em `packages/config`) já estão de pé. Os demais pacotes seguem
como placeholders, com scripts no-op para o `turbo` ter o que percorrer; o conteúdo real de
cada um entra pelos cards indicados no `README.md` de cada pasta.

## Fluxo de trabalho

O trabalho é organizado no quadro Trello **Wellness**. Um card = uma branch = um PR,
nomeada com o ID do card (`feat/F-01-monorepo-turborepo`), commits em
[Conventional Commits](https://www.conventionalcommits.org/). Quem abre o PR não faz
merge. Detalhes no card "LEIA PRIMEIRO".
