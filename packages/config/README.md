# @fit-app/config

Configuração compartilhada de eslint, tsconfig e prettier. É a fonte única dessas
três ferramentas no monorepo: nenhum workspace reescreve regra de estilo ou de
rigor de tipos por conta própria.

## O que o pacote exporta

| Subpath                                 | Para que serve                                         |
| --------------------------------------- | ------------------------------------------------------ |
| `@fit-app/config/eslint`                | flat config base (ESLint 10 + typescript-eslint)       |
| `@fit-app/config/prettier`              | configuração de formatação                             |
| `@fit-app/config/tsconfig/base.json`    | rigor de tipos; não emite nada                         |
| `@fit-app/config/tsconfig/library.json` | `base` + emissão de `.js` e `.d.ts`, para `packages/*` |

## Como um workspace consome

Declare o pacote como dependência de desenvolvimento:

```jsonc
// <workspace>/package.json
{
  "type": "module",
  "devDependencies": {
    "@fit-app/config": "workspace:*",
    "eslint": "^10.12.0",
    "prettier": "^3.9.9",
    "typescript": "^6.0.3",
  },
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
  },
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

## Duas pegadinhas que valem ler

**Caminho relativo em `extends` não é relativo a quem faz o extends.** O
TypeScript resolve `include`, `exclude`, `outDir`, `rootDir` e `paths` contra o
arquivo que _declara_ a opção. Se os presets daqui trouxessem `outDir: "dist"`,
cada consumidor emitiria dentro de `packages/config/tsconfig/dist`. Por isso os
presets só carregam opções independentes de caminho, e `include`, `outDir` e
`rootDir` são sempre locais.

**Os presets assumem ESM.** `module: NodeNext` com `verbatimModuleSyntax` exige
`"type": "module"` no `package.json` do workspace; sem isso o TypeScript resolve
o arquivo como CommonJS e recusa `export` (TS1287).

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

Não há preset de tsconfig nem de eslint específicos para NestJS e Next.js. Eles
dependem de decisões que só existem junto com o código de `apps/api` (card F-05)
e `apps/web` (card F-13) — decorators e `emitDecoratorMetadata` num caso, JSX e
`eslint-config-next` no outro. Cada um desses cards acrescenta o seu preset aqui,
validado contra a aplicação real.
