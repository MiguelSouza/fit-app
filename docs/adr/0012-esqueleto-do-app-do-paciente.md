# 0012. Esqueleto do app do paciente: Riverpod, go_router, tema por tokens e ambientes por `--dart-define`

- **Status:** aceito
- **Data:** 2026-10-16

## Contexto

O `CLAUDE.md` já decide duas coisas do app: é Flutter com **Riverpod**, e ele
**só fala com a API** (regra 6) — nada de banco, nada de regra de negócio.
O [ADR 0008](./0008-contratos-em-zod-e-clientes-gerados.md) decide a terceira: o
cliente Dart é gerado do OpenAPI, com `dart-dio` e `built_value`, e **não** é
versionado. O login é do Supabase Auth
([0002](./0002-supabase-como-infraestrutura.md)) e quem valida o JWT é a API,
com guard global ([0007](./0007-autenticacao-por-jwt-do-supabase.md)).

Falta o que o card F-14 pede: por onde se navega, onde mora a sessão no
dispositivo, de onde saem as cores e os tamanhos de letra, e como o app sabe com
qual ambiente está falando. São escolhas de estrutura, e quatro delas ficam
caras de desfazer depois que houver vinte telas.

O painel passou pela mesma lista um card antes
([0011](./0011-sessao-do-painel-em-cookie.md)); o que vale lá nem sempre vale
aqui, porque não há servidor renderizando nada no meio.

## Decisão

**Navegação com `go_router`, e o que é protegido numa função pura.** O
`redirect` do router pergunta a `redirectFor(signedIn:, location:)`, em
`lib/src/app/router.dart`, e essa função é todo o "o que exige sessão" do app.
A lista de rotas públicas é **fechada** (`publicPaths`), e não um padrão de
caminho: é a mesma assimetria do guard global da API — esquecer de abrir uma
rota dá um redirecionamento que alguém percebe na hora, enquanto uma tela de
paciente aberta por esquecimento não aparece. O que move o app depois de entrar
e de sair é o `refreshListenable`, não um `push` na tela: a sessão muda, o
redirect responde de novo.

**A sessão é do `supabase_flutter`, e o app não guarda cópia.** Quem mantém a
sessão, renova o token e a restaura no próximo início é o cliente do Auth.
Nenhum provider guarda `Session` nem token; quem precisa de um pergunta na hora
da requisição (`AccessTokenInterceptor`), porque o token vale uma hora. Revogar
consentimento ou encerrar a sessão não deixa cópia para trás em lugar nenhum.

**Do Supabase, só o `auth`.** O provider entrega `client.auth`, não o cliente
inteiro — sem o cliente completo não existe `.from()`, `.rpc()` nem `.storage`
para alguém chamar sem querer, e a regra 6 do `CLAUDE.md` passa a ser erro de
compilação em vez de item de revisão. É o mesmo recorte que o painel faz.

**Tema escuro como padrão, e único, montado de tokens.** `app_colors.dart` é o
único arquivo do app com valor hexadecimal; `app_typography.dart`, o único com
tamanho de letra; `app_theme.dart` junta os dois num `ThemeData`, e toda tela lê
`Theme.of(context)`. O card **OP-06** (design system) muda dois arquivos, não
quarenta widgets, e o teste de tema é o que avisa quando alguém escreve uma cor
dentro de uma tela. Fonte nenhuma é embarcada: a família é a da plataforma até
OP-06 escolher uma.

**Ambientes por `--dart-define`, não por flavors.** Três ambientes (local,
staging, produção) e as mesmas três variáveis que o `.env.example` já
documenta. O define entra no binário na compilação, então
`AppConfig.fromEnvironment` é o único lugar do app que toca
`String.fromEnvironment`; o resto lê `appConfigProvider`, que é injetado no
`ProviderScope`. `API_URL`, `SUPABASE_URL` e `SUPABASE_ANON_KEY` são
obrigatórios e sem valor padrão — padrão deixaria uma build de staging
conversando com a máquina de alguém em silêncio, e para uma chave não existe
padrão honesto. `APP_ENV` tem padrão `local`, que é o ambiente em que estar
errado não custa nada, e é também o motivo de um valor desconhecido nunca ser
lido como produção. Toda build que não é produção carrega um selo na tela.

**Flavors ficam de fora** porque o que muda entre ambientes aqui é endereço, não
ícone, nome de aplicativo nem identificador de loja. Flavor custa um
`productFlavors` no Gradle e um esquema no Xcode, duplicados por ambiente, e o
que isso compraria — instalar os três lado a lado no mesmo aparelho — ninguém
pediu. Quando pedirem, o `AppConfig` continua igual: só muda quem passa os
defines.

**Erro do `dio` para na borda.** `api_failure.dart` traduz `DioException` para
um `ApiFailure` com o que a tela precisa: a mensagem do envelope da API (que o
contrato garante em pt-BR e sem dado de paciente) e se foi 401. A exceção do
`dio` não passa dessa linha: ela carrega a requisição, cabeçalhos inclusive, e o
cabeçalho desta é o token.

**Nada é logado.** Nem o erro do Auth, que carrega o e-mail da tentativa; nem o
corpo de uma resposta que não é o envelope; e o `debug` do `supabase_flutter`
fica **desligado em todos os ambientes**, porque o que ele imprime é o tráfego
do Auth, sessão inclusa. Erro virou estado de tela, não linha de log.

**O gate é `flutter analyze` e `flutter test`, rodados à mão.** O app não é
pacote pnpm, não entra no turbo e não entra no CI — o
[ADR 0010](./0010-ci-no-github-actions.md) já deixou `apps/mobile` de fora de
propósito, porque o job precisaria do SDK do Flutter. O `analysis_options.yaml`
é o equivalente do eslint daqui, e fixa o formatador em 100 colunas, a mesma
largura do prettier do resto do repositório. O hook de commit **não** chama
`dart format`: ele rodaria na máquina de quem não tem o SDK e quebraria o commit
de quem nunca abriu o app.

## Consequências

Uma tela nova é um `GoRoute` e um arquivo em `lib/src/<assunto>/`, e já nasce
protegida por não estar em `publicPaths`. Uma tela pública é o arquivo **mais**
uma linha nessa lista — e esquecer a linha dá redirecionamento, não vazamento.

Rodar o app exige quatro defines na linha de comando, e esquecer um derruba o
app no primeiro frame com o nome do que falta. É mais ruidoso que um `.env` e é
o preço de não ter endereço padrão escondido no binário. Os comandos prontos
estão no [README do app](../../apps/mobile/README.md).

Trocar o Supabase Auth por outro provedor mexe em dois arquivos
(`auth_providers.dart` e o `initialize` do `main.dart`): nenhuma tela importa
`supabase_flutter`.

O app depende de um pacote que não está no repositório: `packages/api_client` é
gerado por `pnpm api:generate` (ADR 0008) e ignorado pelo git. Clone novo roda
esse comando, mais o `build_runner` do pacote gerado, antes do primeiro
`flutter pub get`. Em troca, não há cliente HTTP escrito à mão e nenhum tipo de
resposta digitado duas vezes.

**O que ainda não fecha:** a sessão real é recusada pela API, exatamente como no
painel ([0011](./0011-sessao-do-painel-em-cookie.md)). O Auth local assina o
token do usuário em **ES256** e o guard da API valida **HS256**, então
`GET /v1/me` com a sessão de um login de verdade responde 401 com o motivo
`algorithm` — o app mostra a recusa e oferece entrar de novo, que é o que ele
deve fazer com um 401. Entrar e sair funcionam; o que falta é a API ler o JWKS,
que o ADR 0007 deixou de fora de propósito. É decisão daquele ADR, e vira um ADR
novo quando for tomada.

A sessão fica guardada onde o `supabase_flutter` a guarda: `SharedPreferences`,
em claro, no armazenamento do app. Para um app que carrega dado de saúde isso
merece um armazenamento protegido pelo sistema (Keychain, Keystore), o que é uma
dependência nova e uma decisão própria — fica para o card de endurecimento do
app, não para o esqueleto.
