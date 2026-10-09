# .archon/

Tooling do [Archon](https://github.com/webdevtodayjason/archon) para este repositório:
o workflow que leva um card do quadro Trello **Wellness** até o PR, sem merge.

Isto não é código do produto. O prettier não formata esta pasta
(veja `.prettierignore`): o formato do YAML e do Markdown aqui é ditado por quem
o lê, que é o Archon. O eslint, esse sim, vale para `scripts/*.ts` — é código
que roda, e `pnpm lint` o cobre junto com os arquivos de configuração da raiz.

## Como rodar

```bash
archon workflow run card-simples F-04
```

O ID do card é o único argumento. O workflow cria um worktree isolado, lê o
card, implementa, valida, revisa com contexto limpo, abre o PR e devolve o card
para "Revisão". **Nunca faz merge** — quem revisa e move para "Feito" é o
fundador.

## O que precisa estar configurado

Os passos que falam com o Trello não usam IA: são chamadas diretas à API, em
[`scripts/trello.ts`](./scripts/trello.ts). Eles precisam de duas credenciais em
`~/.archon/.env`:

```
TRELLO_API_KEY=...
TRELLO_TOKEN=...
```

Gere as duas em <https://trello.com/power-ups/admin>, aba **API key**. Esse
arquivo mora fora do repositório de propósito, e o Archon o injeta nos nós de
`bash:` e `script:`.

Um `.env` **dentro** do repositório não serve: o Archon invoca os scripts com
`--no-env-file` justamente para que o `.env` do projeto não vaze para o tooling.

Além disso: `bun` (os scripts rodam nele), `gh` autenticado (abre o PR) e
Docker, quando o card mexer com o banco local.

## Por que o Trello não passa por IA

O conector do Trello do claude.ai **não existe dentro do Archon**: nós Claude de
workflow excluem o MCP ambiente do usuário por padrão e só enxergam os servidores
declarados no `mcp:` do próprio nó. Na primeira execução real (card F-03) o
agente ficou sem nenhuma ferramenta de Trello, não conseguiu ler o card e seguiu
adivinhando o escopo a partir do `CLAUDE.md`.

A saída foi tirar a IA do caminho em vez de instalar um servidor MCP de
terceiros com acesso à conta: ler e mover card é mecânico, e uma chamada REST
não alucina. O `scripts/trello.ts` copia a descrição do card **sem alterar uma
palavra** — é isso que o agente lê.

## Os passos do workflow

| # | Nó | IA? | O que faz |
| --- | --- | --- | --- |
| 1 | `ler-card` | não | Lê o card, confere que toda dependência está em "Feito", move para "Fazendo" e grava `card.md` |
| 2 | `preparar` | não | `pnpm install` no worktree novo |
| 3 | `implementar` | sim | Implementa o card em commits pequenos |
| 4 | `validar` | não | `lint`, `typecheck`, `test`, `build` e `format:check` |
| 5 | `revisar` | sim | Revisor com contexto limpo, que não escreveu o código |
| 6 | `abrir-pr` | sim | Abre o PR e grava a URL em `pr-url.txt` |
| 7 | `fechar-card` | não | Comenta o PR no card e move para "Revisão" |

O passo 1 **para a execução** se uma dependência não estiver em "Feito". É de
propósito: o quadro manda não começar card com dependência aberta.
