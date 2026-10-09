# fit-app

Plataforma para nutricionistas esportivos que prescrevem a dieta e acompanham o paciente
num só lugar, cruzando alimentação, treino, sono e sintomas para mostrar **quem precisa de
atenção e por quê**.

Antes de escrever qualquer código, leia o [`CLAUDE.md`](./CLAUDE.md): ele manda sobre
arquitetura, fronteiras de módulo, LGPD e convenções.

## Pré-requisitos

| Ferramenta | Versão |
| --- | --- |
| Node | 24 LTS (ver [`.nvmrc`](./.nvmrc) — `nvm use`) |
| pnpm | 12 (`corepack enable` usa a versão fixada em `packageManager`) |
| Flutter | só para `apps/mobile` (ver card F-14) |

## Como rodar

```bash
pnpm install          # instala todo o workspace
pnpm dev              # sobe tudo em modo de desenvolvimento
pnpm build            # build de todos os pacotes
pnpm lint             # lint
pnpm typecheck        # checagem de tipos
pnpm test             # testes
```

Cada script da raiz delega ao turbo. Para rodar em um pacote só, use o filtro:

```bash
pnpm turbo run build --filter=@fit-app/api
pnpm turbo run test  --filter=@fit-app/contracts
```

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

Este commit entrega só o esqueleto do monorepo (card **F-01**). Os pacotes existem com
scripts no-op para o `turbo` ter o que percorrer; o conteúdo real de cada um entra pelos
cards indicados no `README.md` de cada pasta.

## Fluxo de trabalho

O trabalho é organizado no quadro Trello **Wellness**. Um card = uma branch = um PR,
nomeada com o ID do card (`feat/F-01-monorepo-turborepo`), commits em
[Conventional Commits](https://www.conventionalcommits.org/). Quem abre o PR não faz
merge. Detalhes no card "LEIA PRIMEIRO".
