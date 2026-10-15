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

| Variável                        | Para que serve                  |
| ------------------------------- | ------------------------------- |
| `NEXT_PUBLIC_API_URL`           | endereço da API                 |
| `NEXT_PUBLIC_SUPABASE_URL`      | endereço do Supabase            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave pública (anon) do projeto |

As três vão para o navegador, e nenhuma é segredo. Chave de serviço não entra
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
    (auth)/              telas sem sessão: login, recuperar-senha, nova-senha
    (painel)/            tudo que exige sessão: layout com menu + as 4 seções
    auth/callback        troca o código do link de e-mail por uma sessão
    auth/sign-out        encerra a sessão (POST)
  components/
    ui/                  primitivos do shadcn/ui, neutros (card OP-06 veste)
    auth/                os três formulários de entrada
    painel/              menu lateral, cabeçalho de seção, cartão de identidade
    query-provider.tsx   o cache do TanStack Query
  lib/
    env.ts               as NEXT_PUBLIC_*, validadas com Zod
    routes.ts            os caminhos, e quais são públicos
    api/                 o cliente da API e as queries
    supabase/            Auth no navegador, no servidor e no proxy
  proxy.ts               roda antes de toda requisição (era "middleware")
```

Duas pastas, dois grupos de rota. Uma tela nova que exige sessão nasce dentro de
`(painel)`, e já nasce protegida: o layout do grupo é quem checa. Uma tela que
responde sem sessão vai em `(auth)` **e** entra na lista de `PUBLIC_PATHS` de
`lib/routes.ts` — a lista é fechada de propósito, para esquecimento dar
redirecionamento visível em vez de rota aberta.

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
  o e-mail da tentativa. Erro virou estado da tela, não linha de log.
- **O e-mail da conta aparece no menu** porque é a conta de quem está olhando.
  Não passa por log nem vai para a API.
- **Uma mensagem só para falha de login**, como o 401 da API: dizer "este e-mail
  não existe" entrega quem tem conta na plataforma a quem está só tentando. E a
  recuperação de senha responde igual exista a conta ou não.
- **`?destino=` é filtrado** (`internalPath`): sem isso a tela de entrada seria
  um redirecionador aberto.

## O que ainda não tem

- **A fila, os pacientes, os convites e os ajustes.** As quatro rotas existem e
  dizem o que vai aparecer nelas; o dado vem dos cards de cada módulo.
- **O nome de quem entrou.** `GET /v1/me` responde id, papel e fuso horário —
  nome e e-mail são dado pessoal e vêm com o endpoint de perfil do `identity`,
  que registra o acesso. Ver `packages/contracts/src/identity/me.ts`.
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
