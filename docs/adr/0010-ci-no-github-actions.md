# 0010. CI no GitHub Actions, um job só com `turbo --affected`, e a `main` protegida

- **Status:** aceito
- **Data:** 2026-10-14

## Contexto

Até aqui nada impedia uma branch quebrada de chegar na `main`. Os hooks do husky
([`.husky/`](../../.husky)) são o único portão que existe, e eles são fracos de
propósito: o `pre-commit` só vê o que está em _stage_, o `commit-msg` só vê a
mensagem, e `git commit --no-verify` pula os dois. O `README.md` já dizia, sobre
o `--no-verify`, que "aí o CI é quem pega" — e o CI não existia.

O que precisa ser verificado já está pronto e é barato. O repositório é um
Turborepo com sete pacotes pnpm, todos com as mesmas tarefas de `lint`,
`typecheck` e `build`, e o card F-11 separou os testes em dois perfis: o rápido,
que precisa só do Node, e o de integração, que sobe um Postgres descartável com
Testcontainers e portanto precisa de Docker. Os dois perfis existem onde há
teste para rodar — hoje `test:unit` em `apps/api` e `packages/config`, e
`test:integration` só em `apps/api` —, e é por isso que o CI chama as duas
tarefas em vez do `test`: onde a tarefa não existe, o turbo não tem o que rodar.

Medido nesta branch, com as dependências já instaladas, o conjunto inteiro —
lint, formatação, typecheck, 151 testes unitários, os testes de integração com o
contêiner e o build — fica na casa de **dezenas de segundos**. O custo fixo é
outro: `pnpm install`, que em máquina fria é questão de minutos.

O código já mora no GitHub (`MiguelSouza/fit-app`), e o fluxo de trabalho já é
um card, uma branch, um PR, com quem abre o PR não fazendo o merge. Falta a
peça que torna isso verificável em vez de combinado.

O card F-12 fixa o que o CI tem de fazer: rodar em todo PR e em todo push na
`main`, instalar com cache do pnpm, rodar lint, typecheck, testes unitários,
testes de integração com Docker e build, usar o Turborepo para rodar **só o que
mudou**, proteger a `main` exigindo PR com CI verde, e fechar tudo isso em
**menos de dez minutos**.

## Decisão

O CI é o **GitHub Actions**, em um arquivo —
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — disparado por
`pull_request` (qualquer destino) e por `push` na `main`.

**Um workflow, um job, chamado `ci`.** O custo fixo deste pipeline é o
`pnpm install`, não as tarefas. Quebrar lint, typecheck, testes e build em jobs
paralelos pagaria aquele install uma vez por job para paralelizar trabalho que
já leva segundos, e deixaria a `main` com seis _status checks_ obrigatórios para
manter em sincronia em vez de um. Os passos são, em ordem: checkout, pnpm, Node,
install, `lint`, `lint:root`, `format:check`, `typecheck`, `test:unit`,
`test:integration`, `build`. Falha em qualquer um reprova o job, e um job
reprovado é o check `ci` vermelho.

**O Node e o pnpm vêm do repositório, não do workflow.** O
`actions/setup-node` lê a versão do [`.nvmrc`](../../.nvmrc), o mesmo arquivo do
`nvm use`, e o `pnpm/action-setup` roda sem versão fixada, lendo o
`packageManager` do `package.json` da raiz. Não existe uma segunda lista de
versões para alguém esquecer de atualizar.

**O cache do install é o _store_ do pnpm**, pelo `cache: pnpm` do
`actions/setup-node`, com chave no `pnpm-lock.yaml`. O install roda com
`--frozen-lockfile`: o lockfile é revisado no PR, e um CI que resolvesse
silenciosamente outra árvore de dependências estaria testando algo que ninguém
leu.

**Toda tarefa do turbo roda com `--affected`**, que é o jeito do turbo de pedir
`--filter=...[main...HEAD]`: os pacotes que mudaram entre a `main` e a branch,
mais os que dependem deles. Por isso o checkout é `fetch-depth: 0` — o que o
turbo não consegue ver ele considera mudado, e um checkout raso transformaria
todo run em um run completo sem avisar. Pela mesma razão o
[`turbo.json`](../../turbo.json) liga o `githubActionsRemoteBaseRefFallback`: o
`actions/checkout` deixa um HEAD destacado, onde a `main` existe só como
`origin/main`.

Dois passos ficam **fora do turbo e rodam sempre**, porque não há o que o
`--affected` estreite: o `lint:root`, que cobre os arquivos de configuração da
raiz e os scripts em `.archon/`, que não pertencem a nenhum workspace; e o
`format:check`, que o prettier roda no repositório inteiro a partir da
configuração da raiz. Esse segundo é a metade do `pre-commit` que faltava
cumprir a promessa do `README.md` sobre o `--no-verify`.

**Os testes de integração rodam no Docker do próprio runner.** O
`ubuntu-latest` já entrega um _daemon_ de pé, então o perfil sobe o Postgres com
Testcontainers sem nenhum passo de preparação — e a tarefa `test:integration` é
`cache: false` no `turbo.json`, de propósito, porque o daemon não entra no hash.

**O orçamento de dez minutos do card está escrito como `timeout-minutes: 10`.**
Um CI que passa de dez minutos falha e é olhado, em vez de virar o novo normal
em silêncio.

A **`main` está protegida** com a proteção de branch clássica do GitHub: PR
obrigatório (`required_pull_request_reviews` com **zero** aprovações exigidas),
o check **`ci`** obrigatório, `enforce_admins` ligado, e sem _force push_ nem
remoção da branch. Zero aprovações porque o repositório tem um mantenedor e o
GitHub não deixa ninguém aprovar o próprio PR — exigir uma aprovação travaria
todo merge; o que a regra garante é que nada entra na `main` sem passar por um
PR com CI verde. `enforce_admins` ligado porque uma proteção que o único
mantenedor contorna por padrão não é proteção.

Ficam **explicitamente de fora**:

- **Remote Cache (Vercel) e cache do `.turbo` em `actions/cache`.** O
  `--affected` já corta o trabalho pelo que mudou, e o pipeline inteiro cabe em
  segundos; um cache remoto traria token, conta e a chance de um _cache hit_
  afirmar um resultado que ninguém produziu. Entra se e quando o tempo de CI
  virar problema medido.
- **Jobs paralelos por tarefa, matriz de sistema operacional e matriz de Node.**
  A API roda em Linux no ECS Fargate (ADR [0005](./0005-aws-sa-east-1-e-vercel.md))
  e em uma única versão de Node, a do `.nvmrc`. Uma matriz testaria ambientes
  que não existem.
- **`apps/mobile`.** É Flutter, está fora do workspace pnpm e o turbo não o
  percorre. O CI dele precisa do SDK do Flutter e entra com o card F-14.
- **`pnpm test:archon`.** Os testes do conector do Trello em `.archon/` rodam no
  `bun`, não no turbo, e são ferramenta do Archon, não do produto. O
  `lint:root` já lê esses arquivos.
- **`commitlint` no CI.** A mensagem é verificada no `commit-msg`, e repetir isso
  no CI exigiria reconstruir o intervalo de commits do PR para pegar o caso do
  `--no-verify`. Fica para quando doer.
- **Deploy, build de imagem e qualquer CD.** Este workflow só lê o repositório
  (`permissions: contents: read`): não publica nada, não assume nenhum papel na
  AWS e não toca em segredo. Deploy entra com os cards de infraestrutura.
- **Merge queue e `strict: true`** (exigir a branch atualizada antes do merge).
  Com um card por vez, exigir _rebase_ a cada merge seria atrito sem ganho; e o
  run de `push` na `main` verifica o commit de merge logo depois, então uma
  combinação ruim aparece em minutos, na `main`, e não passa calada.

## Consequências

Um PR com teste quebrado, tipo errado, lint sujo ou formatação fora do padrão
fica vermelho e não pode ser mesclado. É o ponto.

O nome do job (`ci`) passou a ser um contrato: ele é o check que a `main` exige.
Renomear o job sem atualizar a proteção faz o check obrigatório parar de
reportar, e **todo PR fica travado em "esperando"** — não vermelho, travado, que
é mais confuso. O `ci.yml` e o `README.md` dizem isso no lugar em que a pessoa
vai mexer.

Ninguém mais empurra direto para a `main`, inclusive o dono do repositório. Para
um reparo de emergência, a saída é desligar o `enforce_admins`, fazer o que tem
de ser feito e religar; o comando está no `README.md`. Essa configuração vive no
GitHub, não no repositório: ela não aparece em diff de PR e não volta com um
`git revert`.

O `--affected` significa que um PR que mexe só em `apps/api` não roda o lint de
`packages/contracts`. É o que o card pede, e o preço é que uma mudança que
afeta um pacote sem tocar em nenhum arquivo dele passa pelo CI sem ser
verificada. O turbo cobre o caso comum: mudança em `package.json` da raiz, no
`turbo.json` ou no lockfile seleciona **tudo**, e `packages/config` é
dependência de todos, então mexer nas regras compartilhadas também seleciona
tudo.

O run de `pull_request` é cancelado por um push novo na mesma branch; o de
`push` na `main` nunca é. O primeiro é feedback, e feedback obsoleto é
desperdício; o segundo é o registro de que aquele commit da `main` presta, e é
contra a `main` que o `--affected` do próximo PR compara.

Reverter esta decisão é apagar um arquivo e uma chamada de API: remover
`.github/workflows/` e desfazer a proteção da branch. Nada no código do produto
depende do CI existir.
