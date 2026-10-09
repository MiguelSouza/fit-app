# @fit-app/config

Configuração compartilhada de eslint, tsconfig e prettier. É a fonte única dessas
três ferramentas no monorepo: nenhum workspace reescreve regra de estilo ou de
rigor de tipos por conta própria.

## O que o pacote exporta

| Subpath                                 | Para que serve                                         |
| --------------------------------------- | ------------------------------------------------------ |
| `@fit-app/config/eslint`                | flat config base (ESLint 10 + typescript-eslint)       |
| `@fit-app/config/eslint/api`            | a base + a fronteira entre os módulos de `apps/api`    |
| `@fit-app/config/prettier`              | configuração de formatação                             |
| `@fit-app/config/tsconfig/base.json`    | rigor de tipos; não emite nada                         |
| `@fit-app/config/tsconfig/library.json` | `base` + emissão de `.js` e `.d.ts`, para `packages/*` |
| `@fit-app/config/tsconfig/nest.json`    | `base` + decorators e CommonJS, para `apps/api`        |

## Como um workspace consome

Declare o pacote como dependência de desenvolvimento:

```json
// <workspace>/package.json
{
  "type": "module",
  "devDependencies": {
    "@fit-app/config": "workspace:*",
    "eslint": "^10.12.0",
    "prettier": "^3.9.9",
    "typescript": "^6.0.3"
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  }
}
```

ESLint — crie `<workspace>/eslint.config.mjs`:

```js
export { default } from '@fit-app/config/eslint';
```

TypeScript — crie `<workspace>/tsconfig.json`:

```jsonc
{
  "extends": "@fit-app/config/tsconfig/library.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"],
}
```

Prettier não precisa de arquivo por workspace: o `prettier.config.mjs` da raiz
vale para todo o repositório, e `pnpm format` / `pnpm format:check` rodam de lá.

## A fronteira entre os módulos da API

`eslint/api.js` transforma a regra 1 do `CLAUDE.md` ("Fronteira de módulo") em
erro de lint: de dentro de um módulo de `apps/api/src/modules`, os outros
módulos existem só pelo `index.ts`.

```ts
// apps/api/src/modules/nutrition/application/create-plan.ts
import { Person } from '../../identity/domain/person'; // ✗ erro de lint
import { Person } from '../../identity'; //              ✓ o index.ts do módulo
import { Meal } from '../domain/meal'; //                ✓ o próprio módulo
```

A regra é o `no-restricted-imports` do eslint, sem plugin de terceiros. Ela
reconhece as três formas de escrever o caminho (relativo, `modules/...` e o
alias `@modules/...`) e **não** se confunde com uma pasta interna que por acaso
tenha nome de módulo: `../domain/health/score` dentro de `nutrition` passa, mas
`../../health/domain/score` não. Quem garante isso é
[`test/module-boundaries.test.js`](./test/module-boundaries.test.js), com 21
casos de import (`pnpm --filter @fit-app/config test`).

Acrescentar um módulo de domínio é acrescentar o nome em `apiModules`, dentro de
`eslint/api.js` — o teste falha se um módulo do `CLAUDE.md` ficar sem fronteira.

`apps/api` consome esse preset no próprio `eslint.config.mjs`, e o da raiz
aponta para ele também: editor e hook de pre-commit enxergam a regra em quem
edita `apps/api` a partir da raiz do monorepo.

Por isso o `files` da fronteira nomeia o mesmo arquivo de duas formas. O eslint
10 aplica o config mais próximo do arquivo e casa o `files` contra o caminho
relativo a ele, então o mesmo módulo é `apps/api/src/modules/...` quando o
config da raiz responde e `src/modules/...` quando o de `apps/api` responde —
que é o caso de `pnpm --filter api lint`, ou seja, do `turbo run lint`. Nomear
só a primeira forma deixaria a fronteira desligada justamente onde o código
está; o teste cobre as duas.

Uma regra fica desligada lá, e não aqui: `consistent-type-imports`. O NestJS
descobre a dependência de um construtor pelo metadado de tipo que
`emitDecoratorMetadata` escreve, e esse metadado só existe para import de
valor; a regra vê uma classe usada apenas como tipo de parâmetro, troca por
`import type` e apaga o metadado. Como o desligamento vale só para quem tem
decorator, ele mora no `eslint.config.mjs` de `apps/api` em vez de valer para o
monorepo inteiro.

## Duas pegadinhas que valem ler

**Caminho relativo em `extends` não é relativo a quem faz o extends.** O
TypeScript resolve `include`, `exclude`, `outDir`, `rootDir` e `paths` contra o
arquivo que _declara_ a opção. Se os presets daqui trouxessem `outDir: "dist"`,
cada consumidor emitiria dentro de `packages/config/tsconfig/dist`. Por isso os
presets só carregam opções independentes de caminho, e `include`, `outDir` e
`rootDir` são sempre locais.

**O `base` assume ESM.** `module: NodeNext` com `verbatimModuleSyntax` exige
`"type": "module"` no `package.json` do workspace; sem isso o TypeScript resolve
o arquivo como CommonJS e recusa `export` (TS1287). `apps/api` é justamente o
caso contrário — um pacote CommonJS — e é por isso que o preset `nest` desliga
`verbatimModuleSyntax`.

## `any` e o escape hatch

`@typescript-eslint/no-explicit-any` é erro, como manda o `CLAUDE.md`. Quando
`any` for inevitável, a justificativa é obrigatória e vai na própria diretiva:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a lib X não publica tipos
function adapt(raw: any) {}
```

`reportUnusedDisableDirectives` é erro também: quando o `any` sumir, a diretiva
órfã quebra o lint em vez de virar entulho.

## O que ainda não está aqui

A regra 4 do `CLAUDE.md` ("Domínio puro": `domain/` não importa NestJS, Drizzle
nem nada com I/O) não está no lint — enquanto isso vale a revisão de PR. A
fronteira de módulo foi em frente porque depende só dos nomes dos módulos, que o
`CLAUDE.md` já fixa.

Não há preset para Next.js: ele depende de decisões que só existem junto com o
código de `apps/web` (card F-13) — JSX e `eslint-config-next`. Esse card
acrescenta o seu preset aqui, validado contra a aplicação real, como o card F-05
fez com o `tsconfig/nest.json`.
