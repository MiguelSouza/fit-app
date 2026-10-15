# 0011. Sessão do painel em cookie, com o proxy do Next.js na frente das rotas

- **Status:** aceito
- **Data:** 2026-10-15

## Contexto

O painel é um Next.js com App Router ([0005](./0005-aws-sa-east-1-e-vercel.md),
na Vercel) e o login é do Supabase Auth
([0002](./0002-supabase-como-infraestrutura.md)). A API valida o JWT com guard
global ([0007](./0007-autenticacao-por-jwt-do-supabase.md)). Falta dizer onde a
sessão mora no lado do navegador, e quem barra uma rota que exige sessão.

A escolha óbvia do Supabase — `localStorage` — resolve o navegador e quebra o
resto. No App Router, a maior parte do que renderiza é Server Component: ele roda
antes de o JavaScript do cliente existir e só vê o que veio na requisição. Sessão
em `localStorage` é sessão que o servidor não enxerga, e o efeito prático é que
toda tela protegida tem de renderizar vazia, esperar o cliente hidratar,
descobrir que não há sessão e só então redirecionar — ou seja, dado de paciente
sendo buscado em telas que não deveriam ter aberto.

O Next.js 16 renomeou o middleware para **proxy** (`proxy.ts`), e a própria
documentação dele avisa: proxy serve para checagem otimista, não é solução de
sessão nem de autorização.

## Decisão

**A sessão vive em cookie**, pelo `@supabase/ssr` (`createBrowserClient` no
navegador, `createServerClient` no servidor). O cookie é a única cópia, e é
`HttpOnly` nenhum — o cliente do Auth precisa lê-lo para renovar o token — mas é
`SameSite=Lax` e, em produção, `Secure`, como o pacote o escreve.

**A checagem acontece em duas camadas, e elas têm papéis diferentes:**

- **O `proxy.ts`** renova o token antes de a resposta sair (Server Component não
  escreve cookie, então alguém tem de fazer isso) e redireciona rota protegida
  sem sessão para `/login`, guardando o destino em `?destino=`. É a camada
  barata, que evita renderizar o que não deve.
- **O layout de `(painel)`** chama `getUser()`, que confere o token com o
  servidor do Auth, e só então renderiza. É a camada que verifica. Toda página
  protegida está dentro desse grupo de rotas, então **rota nova nasce
  protegida** por estar na pasta.

**A lista de rotas públicas é fechada** (`PUBLIC_PATHS`, em `lib/routes.ts`), e
não um padrão de caminho — a mesma assimetria do guard global da API: esquecer de
abrir uma rota dá um redirecionamento que alguém percebe na hora, enquanto uma
rota de paciente aberta por esquecimento não aparece.

**`getUser()` e nunca `getSession()` quando a pergunta é "quem é?".**
`getSession` só decodifica o cookie, que é dado de entrada. `getSession` continua
sendo usado para uma coisa só: pegar o access token para mandar à API, que é
quem o verifica.

**Sair é `POST`**, numa rota própria (`app/auth/sign-out`), e o menu tem um
`<form method="post">`. Num `GET`, qualquer coisa que pré-carregue URL — o
navegador, um antivírus, o `<Link>` do Next.js — deslogaria a pessoa sem que ela
clicasse em nada.

**O cliente do Supabase sai dos construtores recortado**: eles devolvem
`cliente.auth`, não o cliente inteiro. Sem o cliente completo não existe
`.from()`, `.rpc()` nem `.storage` para alguém chamar sem querer, e a regra 6 do
`CLAUDE.md` passa a ser erro de compilação em vez de item de revisão.

Ficam **explicitamente de fora**:

- **Chamar a API a partir do servidor do painel.** Renderizar no servidor
  passando o token daria uma primeira pintura com dado pronto, e custaria um
  segundo caminho de chamada para manter — com cache do Next.js no meio,
  guardando resposta sobre paciente. Toda chamada à API sai do navegador, com o
  TanStack Query cuidando do cache; quando um `prefetch` fizer diferença medida,
  ele entra para aquela tela, não para todas.
- **Autorização no painel.** Vínculo, consentimento e `professional_type` são da
  API ([0007](./0007-autenticacao-por-jwt-do-supabase.md)). O painel esconder um
  botão é conveniência, não controle de acesso.
- **Server Actions para login.** O token tem de chegar ao cliente do Auth do
  navegador de qualquer jeito, para ele renovar a sessão. Entrar pelo servidor
  significaria duas cópias da sessão para manter em sincronia.
- **Guardar o token em memória no painel.** Ele vale uma hora e o cliente do Auth
  o renova sozinho; quem pergunta na hora de cada requisição manda um válido.

## Consequências

Uma tela protegida nova é um arquivo dentro de `(painel)`, e não há nada a
lembrar. Uma tela pública é um arquivo em `(auth)` **mais** uma linha em
`PUBLIC_PATHS` — e esquecer essa linha dá redirecionamento, não vazamento.

O proxy roda em toda requisição que não é arquivo estático, e cada uma delas é
uma ida ao Auth (`getUser`). É o custo de não confiar no cookie. O `matcher`
tira o que não tem sessão para renovar.

Trocar o Supabase Auth por outro provedor passa a mexer em quatro arquivos
(`lib/supabase/*` e `proxy.ts`), e não no painel todo: nenhum componente importa
`@supabase/ssr`.

**O que ainda não fecha:** a sessão real do painel é recusada pela API. O Auth
local (CLI 2.120) assina o token do usuário em **ES256**, com chave assimétrica
num JWKS, e o guard da API valida **HS256** com o segredo compartilhado — ele
responde 401 com o motivo `algorithm`. As mesmas claims assinadas em HS256 são
aceitas, então o caminho painel → API está certo e o que falta é a API ler o
JWKS, que o [ADR 0007](./0007-autenticacao-por-jwt-do-supabase.md) deixou de fora
de propósito ("Trocar depois é `supabase-token-verifier.ts` e uma variável").
Forçar o stack local a assinar HS256 não é alternativa: o CLI recusa chave
simétrica em `signing_keys_path` com `unsupported key type: oct`. Isso é decisão
do ADR 0007, e vira um ADR novo quando for tomada.
