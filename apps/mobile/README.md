# apps/mobile

App do paciente: Flutter (Dart), Riverpod e go_router, com tema escuro. É aqui
que o paciente entra, e por onde vão aparecer o plano alimentar, os check-ins e
o diário.

O app **não fala com o banco**. Dado vem da API, pelo cliente Dart gerado do
OpenAPI (`packages/api_client`); do Supabase ele usa só o Auth (regra 6 do
[`CLAUDE.md`](../../CLAUDE.md)). E não há regra de negócio aqui: nenhum valor
desta tela é calculado pelo app.

Não é um pacote pnpm e não está no `pnpm-workspace.yaml` — é construído pelo
toolchain do Flutter, não pelo turbo, e por isso também não entra no CI
([ADR 0010](../../docs/adr/0010-ci-no-github-actions.md)).

## Antes da primeira vez

Precisa do [SDK do Flutter](https://docs.flutter.dev/get-started/install)
(3.47 ou mais novo; o `flutter doctor` diz o que falta para iOS e Android) e,
para gerar o cliente Dart, do Docker que o repositório já pede para o Supabase
local.

```bash
pnpm api:generate                         # escreve packages/api_client (na raiz)
cd apps/mobile/packages/api_client
flutter pub get && dart run build_runner build   # os part files do built_value
cd ../..
flutter pub get
```

O cliente Dart **não é versionado** (ADR
[0008](../../docs/adr/0008-contratos-em-zod-e-clientes-gerados.md)): ele é
gerado do mesmo `apps/api/openapi.json` que o cliente TypeScript, e só compila
depois do `build_runner`. Mudou o contrato? Repita os três comandos acima.

## Como rodar

O app lê três valores obrigatórios, e Flutter não lê `.env`: eles entram por
`--dart-define`. Os valores de desenvolvimento estão no bloco `apps/mobile` do
[`.env.example`](../../.env.example).

```bash
# Emulador Android: 127.0.0.1 é o próprio emulador, o host é 10.0.2.2
flutter run \
  --dart-define=APP_ENV=local \
  --dart-define=API_URL=http://10.0.2.2:3333 \
  --dart-define=SUPABASE_URL=http://10.0.2.2:54321 \
  --dart-define=SUPABASE_ANON_KEY=<a chave anon do pnpm db:start>

# Simulador iOS: compartilha a rede do Mac, então é 127.0.0.1 mesmo
flutter run \
  --dart-define=APP_ENV=local \
  --dart-define=API_URL=http://127.0.0.1:3333 \
  --dart-define=SUPABASE_URL=http://127.0.0.1:54321 \
  --dart-define=SUPABASE_ANON_KEY=<a chave anon do pnpm db:start>
```

Com a API (`pnpm --filter api dev`) e o Supabase local (`pnpm db:start`) de pé.
Esquecer um define derruba o app no primeiro frame dizendo qual faltou — de
propósito: endereço padrão escondido no binário é build de staging falando com a
máquina de alguém sem ninguém notar.

| Define              | O que é                                       | Padrão  |
| ------------------- | --------------------------------------------- | ------- |
| `APP_ENV`           | `local`, `staging` ou `production`            | `local` |
| `API_URL`           | endereço da API da fit-app                    | —       |
| `SUPABASE_URL`      | endereço do Supabase                          | —       |
| `SUPABASE_ANON_KEY` | chave pública (anon) do projeto               | —       |

A chave aqui é a **anon**, que é pública por definição. A chave de serviço
ignora RLS, só a API usa, e não entra no app em nenhuma hipótese.

Toda build que não é produção mostra um selo com o ambiente na tela — um número
visto num teste tem de dizer qual banco respondeu.

| Comando                 | O que faz                                    |
| ----------------------- | -------------------------------------------- |
| `flutter analyze`       | o lint daqui (`analysis_options.yaml`)       |
| `flutter test`          | os testes                                    |
| `dart format lib test`  | formata, em 100 colunas como o resto do repo |
| `flutter build apk`     | Android (os mesmos defines)                  |
| `flutter build ipa`     | iOS (os mesmos defines, precisa de macOS)    |

`flutter analyze` e `flutter test` são o que vale antes de empurrar: o CI não
roda nenhum dos dois, porque o job não tem o SDK do Flutter. O hook de commit
também não chama `dart format` — ele quebraria o commit de quem não tem o SDK
instalado.

## Estrutura

```
lib/
  main.dart                  valida o ambiente, sobe o Supabase, injeta a config
  src/
    app/
      fit_app.dart           MaterialApp.router: tema, locale pt-BR e router
      router.dart            as rotas e `redirectFor`, que diz o que exige sessão
    auth/
      auth_providers.dart    Supabase Auth, entrar e sair
      sign_in_screen.dart    a tela de entrada
    api/
      api_client.dart        o cliente gerado + o token em cada requisição
      api_failure.dart       DioException -> mensagem que pode ir para a tela
      me.dart                GET /v1/me
    core/
      config/                os ambientes, lidos dos defines
      theme/                 tokens de cor e de tipografia, e o ThemeData
    home/
      home_screen.dart       a tela inicial, protegida
    shared/                  os pedaços que mais de uma tela usa
test/                        espelha lib/
packages/api_client/         o cliente Dart gerado (não versionado)
```

Uma tela nova é um `GoRoute` mais um arquivo em `lib/src/<assunto>/`, e já nasce
protegida: `publicPaths`, em `router.dart`, é uma lista fechada, e o que não
está nela exige sessão.

## Sessão, rota protegida e token

Em três passos, e o detalhe de cada um está no
[ADR 0012](../../docs/adr/0012-esqueleto-do-app-do-paciente.md):

1. **Entrar** é `signInWithPassword`, a única coisa que o app pede ao Supabase
   direto. Quem guarda a sessão, renova o token e a restaura no próximo início é
   o `supabase_flutter`; nenhum provider daqui guarda cópia.
2. **O router** pergunta a `redirectFor` em toda navegação, e de novo a cada
   mudança de sessão (`refreshListenable`). É o que leva a pessoa para dentro ao
   entrar e para a tela de entrada ao sair — nenhuma tela navega sozinha.
3. **Nas chamadas à API**, o token vai como `Authorization: Bearer`, lido no
   momento de cada requisição. Um token vencido ganha uma tentativa de renovação;
   se falhar, a API responde 401 e a tela oferece entrar de novo.

Autorização não é daqui. Vínculo ativo, consentimento vigente e tipo de
profissional são checados pela API, dentro do caso de uso
([ADR 0007](../../docs/adr/0007-autenticacao-por-jwt-do-supabase.md)). O app só
sabe se existe sessão.

## Dado de saúde e LGPD

- **Nada é logado.** Nem o erro do Auth (ele carrega o e-mail da tentativa), nem
  o corpo de uma resposta que não é o envelope de erro da API. O `debug` do
  `supabase_flutter` fica desligado em todos os ambientes: o que ele imprime é o
  tráfego do Auth, com a sessão dentro.
- **Uma mensagem só para falha de login**, como o 401 da API: dizer "este e-mail
  não existe" entrega quem tem conta na plataforma a quem está só tentando.
- **A mensagem de erro que aparece na tela é a da API**, que o contrato garante
  em pt-BR e sem dado de paciente. Corpo que não é o envelope recebe um texto
  genérico, e não vai para a tela nem para log.
- **Nenhum dado de paciente é inventado em teste** — nem sintético: o teste da
  tela inicial usa o UUID nulo, o mesmo que o endpoint provisório responde.

## O que ainda não tem

- **As telas do paciente.** Plano alimentar, check-in, diário e medidas vêm com
  os cards dos módulos `nutrition` e `health`.
- **A sessão real aceita pela API.** Entrar e sair funcionam, mas `GET /v1/me`
  com o token de um login de verdade responde 401 no stack local: o Auth assina
  em ES256 e o guard da API valida HS256. É o mesmo ponto aberto do painel
  ([ADR 0011](../../docs/adr/0011-sessao-do-painel-em-cookie.md)), e está na
  mão do [ADR 0007](../../docs/adr/0007-autenticacao-por-jwt-do-supabase.md).
- **Ícone, splash e tipografia de verdade.** O tema é dos tokens, com a família
  da plataforma; a identidade visual é o card OP-06.
- **Recuperação de senha no app.** Hoje a tela manda pedir acesso ao
  nutricionista; o fluxo com link de e-mail e deep link é card próprio.
- **Armazenamento protegido da sessão.** O `supabase_flutter` guarda em
  `SharedPreferences`, em claro. Keychain e Keystore são dependência nova e
  decisão própria (ADR 0012).
- **i18n de verdade.** O texto está em pt-BR direto no widget, como no painel. A
  extração para `.arb` acontece quando houver um segundo idioma.
