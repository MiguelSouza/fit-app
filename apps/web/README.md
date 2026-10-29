# @fit-app/web

Painel do profissional: Next.js 16 (App Router), Tailwind 4, shadcn/ui, TanStack
Query e React Hook Form com Zod. É aqui que o nutricionista entra, vê a fila de
quem precisa de atenção e abre a ficha do paciente.

O painel **não fala com o banco**. Dado vem da API, pelo cliente gerado
(`@fit-app/api-client`); do Supabase ele usa só o Auth (regra 6 do
[`CLAUDE.md`](../../CLAUDE.md)).

## Como rodar

```bash
cp .env.example .env         # na raiz do repositório, não aqui
pnpm db:start                # Supabase local; imprime as chaves
pnpm --filter api dev        # a API, em 127.0.0.1:3333
pnpm --filter @fit-app/web dev
```

O painel sobe em [http://127.0.0.1:3000](http://127.0.0.1:3000). As três
variáveis que ele lê estão no bloco `apps/web` do
[`.env.example`](../../.env.example):

| Variável                         | Para que serve                      |
| -------------------------------- | ----------------------------------- |
| `NEXT_PUBLIC_API_URL`            | endereço da API                     |
| `NEXT_PUBLIC_SUPABASE_URL`       | endereço do Supabase                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | chave pública (anon) do projeto     |
| `NEXT_PUBLIC_SENTRY_DSN`         | para onde vai o erro; vazio desliga |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` | como o ambiente aparece na issue    |
| `NEXT_PUBLIC_SENTRY_RELEASE`     | qual versão mandou (ver "Erros")    |

Todas vão para o navegador, e nenhuma é segredo — o DSN do Sentry também não:
ele deixa mandar evento para o projeto, nunca ler. Chave de serviço não entra
aqui: ela ignora RLS e só a API usa.

O arquivo é o `.env` da **raiz**, um para o monorepo todo. O Next.js só procura
`.env*` ao lado da aplicação, então quem carrega o da raiz é o
[`next.config.ts`](./next.config.ts) — do mesmo jeito que a API faz em
`shared/config/env-file.ts`. Na Vercel não há arquivo nenhum: os valores são
variáveis da build.

| Script      | O que faz                               |
| ----------- | --------------------------------------- |
| `dev`       | servidor de desenvolvimento, porta 3000 |
| `build`     | `next build`                            |
| `start`     | serve o resultado da build              |
| `lint`      | eslint                                  |
| `typecheck` | `tsc --noEmit`                          |

## Estrutura

```
src/
  app/
    layout.tsx           <html>, <body> e os tokens do Tailwind
    globals.css          @theme: a configuração do Tailwind 4 é CSS
    (auth)/              telas fora do painel: login, recuperar-senha, nova-senha, primeiro-acesso
    (painel)/            tudo que exige sessão e perfil: layout com menu + as 4 seções
    auth/callback        troca o código do link de e-mail por uma sessão
    auth/sign-out        encerra a sessão (POST)
    global-error.tsx     a última tela: erro que escapou de tudo, e o relato ao Sentry
  components/
    ui/                  primitivos do shadcn/ui, neutros (card OP-06 veste)
    auth/                os três formulários de entrada
    identity/            o primeiro acesso do profissional e os convites de paciente
    painel/              menu lateral, cabeçalho de seção, cartão de identidade
    debug/               só desenvolvimento: o botão que provoca o erro de teste
    query-provider.tsx   o cache do TanStack Query
    sentry-user.tsx      diz ao Sentry quem está usando — só o id
  lib/
    env.ts               as NEXT_PUBLIC_*, validadas com Zod
    routes.ts            os caminhos, e quais são públicos
    sentry.ts            as opções do Sentry, iguais nos três runtimes
    api/                 o cliente da API (navegador e servidor) e as queries
    supabase/            Auth no navegador, no servidor e no proxy
  instrumentation.ts        liga o Sentry no servidor (hook do Next.js)
  instrumentation-client.ts liga o Sentry no navegador
  sentry.server.config.ts   as opções, no runtime Node
  sentry.edge.config.ts     as opções, no runtime edge
  proxy.ts               roda antes de toda requisição (era "middleware")
```

Duas pastas, dois grupos de rota. Uma tela nova que exige sessão nasce dentro de
`(painel)`, e já nasce protegida: o layout do grupo é quem checa. Uma tela que
responde sem sessão vai em `(auth)` **e** entra na lista de `PUBLIC_PATHS` de
`lib/routes.ts` — a lista é fechada de propósito, para esquecimento dar
redirecionamento visível em vez de rota aberta.

`(auth)` é um formato, não uma regra: o layout do grupo é só o cartão
centralizado e não checa nada. O `/primeiro-acesso` mora lá por isso, e **não**
está em `PUBLIC_PATHS` — ele precisa de sessão, confere a sessão na própria
página, e quem chega sem uma é mandado ao login pelo proxy antes de renderizar.

## Primeiro acesso do profissional

Sessão não é cadastro. Quem entra no Supabase Auth e ainda não tem perfil recebe
**404** em `GET /v1/me`, com o código `identity.profile.not_found`, e é o layout
do painel que lê isso e manda a pessoa para `/primeiro-acesso` — a tela que
pergunta nome, CRN e especialidade e manda `POST /v1/professionals/me` (card
I-01). Concluído o cadastro, o `router.refresh()` faz o servidor renderizar o
painel de novo, agora com perfil.

Quem checa é o layout e não o `proxy.ts`: o proxy roda em toda requisição, e uma
chamada à API por requisição — inclusive as de arquivo estático — seria caro
para a mesma resposta.

API que **não respondeu** não é lida como "não cadastrado" (`lib/api/server.ts`
separa os dois casos). Redirecionar aí mandaria um profissional cadastrado para
uma tela de cadastro por causa de uma falha de rede; o painel fica de pé e o erro
aparece dentro da página.

O cliente do servidor é outro, ao lado do do navegador, porque a sessão vem de
outro lugar: no navegador, do cliente Auth da aba; no servidor, dos cookies da
requisição. Ele é criado a cada chamada e nada é guardado — cliente que
guardasse o token de uma requisição o mandaria na requisição da próxima pessoa.

## Sessão, rota protegida e token

Em três passos, e o detalhe de cada um está no
[ADR 0011](../../docs/adr/0011-sessao-do-painel-em-cookie.md):

1. **Entrar** é `signInWithPassword` no navegador. O `@supabase/ssr` guarda a
   sessão em **cookie**, não em `localStorage`, e é isso que deixa o servidor ler
   a mesma sessão.
2. **O [`proxy.ts`](./src/proxy.ts)** roda antes de tudo: renova o token (uma
   hora de validade) e redireciona rota protegida sem sessão para `/login`,
   guardando o destino em `?destino=`.
3. **O layout de `(painel)`** pergunta ao Auth se o token vale (`getUser`) e só
   então renderiza. O proxy redireciona; este é quem verifica.

Autorização não é daqui. Vínculo ativo, consentimento vigente e
`professional_type` são checados pela API, dentro do caso de uso
([ADR 0007](../../docs/adr/0007-autenticacao-por-jwt-do-supabase.md)). O painel
só sabe se existe sessão.

Nas chamadas à API, o token da sessão vai como `Authorization: Bearer`, lido na
hora de cada requisição — `lib/api/client.ts`.

## Dado de saúde e LGPD

- **Nada é logado.** Nem `console.log` de erro do Auth: o objeto de erro carrega
  o e-mail da tentativa. Erro virou estado da tela, não linha de log — e o que
  vai para o Sentry passa pelo filtro (ver "Erros no Sentry").
- **O e-mail da conta aparece no menu** porque é a conta de quem está olhando.
  Não passa por log nem vai para a API.
- **Uma mensagem só para falha de login**, como o 401 da API: dizer "este e-mail
  não existe" entrega quem tem conta na plataforma a quem está só tentando. E a
  recuperação de senha responde igual exista a conta ou não.
- **`?destino=` é filtrado** (`internalPath`): sem isso a tela de entrada seria
  um redirecionador aberto.

## Erros no Sentry

Erro do painel vai para o Sentry (ADR
[0013](../../docs/adr/0013-sentry-nos-tres-apps.md)), dos três lugares em que
ele pode acontecer: o navegador (`instrumentation-client.ts`), o servidor que
renderiza (`instrumentation.ts`, com `onRequestError`) e o edge
(`sentry.edge.config.ts`). As opções são as mesmas nos três e estão em
[`lib/sentry.ts`](./src/lib/sentry.ts) — uma cópia só, para nenhuma delas
envelhecer sozinha.

Sem `NEXT_PUBLIC_SENTRY_DSN` na build, o SDK nem é iniciado. O ambiente tem
padrão `NODE_ENV` (preview na Vercel é build de produção e não devia aparecer
como produção, daí a variável própria) e a versão, na Vercel, vem do commit do
deploy sem ninguém configurar nada.

O que sai no evento está em
[`@fit-app/observability`](../../packages/observability/README.md), a mesma
lista e o mesmo filtro da API: usuário é **só um id** (quem o informa é
[`sentry-user.tsx`](./src/components/sentry-user.tsx), e o layout do painel no
servidor), requisição fica em método e caminho, texto livre vira
`[redacted]`. Duas coisas ficam desligadas de propósito: **tracing**, que não
é o que este card pede, e **session replay**, que grava a tela — num painel que
mostra paciente, isso é vídeo de dado de saúde saindo do navegador.

O `withSentryConfig` no [`next.config.ts`](./next.config.ts) está lá por um
motivo só: os **source maps**. Ele sobe os mapas e os apaga da saída, para a
pilha na issue nomear nossos arquivos sem servir o código do painel a quem
pedir. Precisa de `SENTRY_ORG`, `SENTRY_PROJECT` e `SENTRY_AUTH_TOKEN` no
ambiente **da build** (na Vercel, nas configurações do projeto); sem eles ele
pula o envio e a build passa igual — que é o que mantém um clone funcionando
sem rede.

### Conferir que está chegando

Só em desenvolvimento existe `/debug/sentry` (dentro de `(painel)`, então
exige sessão; em qualquer build de produção ela responde 404). Um botão estoura
no navegador e um link estoura no servidor:

```bash
# no .env da raiz: NEXT_PUBLIC_SENTRY_DSN=... e NEXT_PUBLIC_SENTRY_RELEASE=web@local
pnpm --filter @fit-app/web dev
# entre no painel e abra http://127.0.0.1:3000/debug/sentry
```

A mensagem dos dois erros leva nome, e-mail e peso sintéticos. Na issue, os
três precisam aparecer como `[redacted]` e o usuário, só como id — é essa
metade que importa. O que o filtro faz é testado na API, contra o SDK real
(`apps/api/src/shared/observability/sentry.spec.ts`), porque o filtro é o
mesmo.

## Convites de paciente

`/convites` (card I-02) tem duas metades. "Convidar paciente" gera o link —
nome e contato são opcionais — e mostra um campo com o link e um botão que
copia. "Convites enviados" lista os da organização, do mais recente para o mais
antigo, com a situação de cada um (pendente, aceito, expirado, revogado) e
"revogar" nos que estão pendentes.

**O link aparece uma única vez.** A API responde o token só na criação e guarda
apenas o hash dele, então não há "ver o link de novo" nem na tela nem no banco
(ADR [0015](../../docs/adr/0015-convite-por-link-com-token-hasheado.md)). Quem
perder o link revoga o convite e gera outro. O token fica no estado do
componente e em lugar nenhum mais: nada de `localStorage`, nada no cache do
TanStack Query, e ele some na próxima navegação.

O link é `<origem do painel>/convite?token=<token>`, montado com
`location.origin`: a origem onde o profissional já está, então não há variável
de ambiente para configurar e não há como apontar para o host errado. O token
vai na **query string**, e não no caminho, por causa do filtro desta
plataforma: o `beforeSend` de `@fit-app/observability` mantém o caminho de uma
URL e joga a query fora, então token no caminho sobreviveria num relato de erro
da tela do paciente e na query não.

A situação do convite vem pronta da API e **não** é calculada aqui: `expirado`
depende do instante da pergunta, e um relógio de navegador adiantado mostraria
como morto um link que ainda funciona.

> A rota `/convite`, que é o que o paciente abre, **ainda não existe
> neste painel**: validar o token e criar a conta do paciente é o card do
> vínculo profissional–paciente. O formato do link já está decidido, então
> aquele card preenche a tela sem mexer no que é gerado aqui.

## O que ainda não tem

- **A fila, os pacientes e os ajustes.** As três rotas existem e dizem o que vai
  aparecer nelas; o dado vem dos cards de cada módulo. Convites já tem conteúdo
  (card I-02).
- **A tela que o paciente abre.** O link do convite aponta para
  `/convite?token=<token>`, que é do card do vínculo profissional–paciente.
- **O nome de quem entrou.** `GET /v1/me` responde id, papel, fuso horário e a
  metade profissional (tipo, conselho, especialidade e organizações) — o nome da
  pessoa não vem, e o único texto livre é o nome do consultório dela. Ver
  `packages/contracts/src/identity/me.ts`.
- **Editar o cadastro.** O primeiro acesso pergunta uma vez; mandar de novo não
  sobrescreve nada. A tela de perfil entra com o card dela.
- **O visual.** Os componentes são os neutros do shadcn/ui, e a paleta é a
  neutra, num bloco `@theme` só. O design system é o card OP-06.
- **Teste automatizado.** O `CLAUDE.md` põe Playwright nos fluxos críticos
  (montar plano, revisar alerta), e nenhum dos dois existe ainda.
- **i18n.** A interface é em pt-BR e `lang="pt-BR"` está no layout raiz; os
  textos estão em português nos componentes, sem frase montada por concatenação,
  esperando a biblioteca de tradução.

> [!IMPORTANT]
> **O `GET /v1/me` ainda responde 401 para a sessão do painel**, e não é coisa
> deste pacote. O Supabase Auth local (CLI 2.120) assina o token do usuário em
> **ES256**, com chave assimétrica publicada num JWKS; a API valida **HS256** com
> o segredo compartilhado, que é a decisão do
> [ADR 0007](../../docs/adr/0007-autenticacao-por-jwt-do-supabase.md) — ela
> recusa com o motivo `algorithm`. O mesmo conjunto de claims assinado em HS256 é
> aceito e responde o contrato, então o caminho painel → API está certo; o que
> falta é a API ler o JWKS (o ADR 0007 deixou isso explicitamente de fora) ou o
> ADR ser revisto. Forçar o stack local a assinar HS256 não é saída: o CLI recusa
> chave simétrica em `signing_keys_path` com `unsupported key type: oct`.
