# 0021. Onboarding do paciente no app: deep link por esquema próprio, uma tela por finalidade e o nome da prática na resposta

- **Status:** aceito
- **Data:** 2026-11-12

## Contexto

O card P-01 é o lado do paciente do que a API já sabe fazer desde o I-03: abrir
o convite, criar a conta, dar os consentimentos e virar paciente de uma prática.
A API está pronta e testada (ADR
[0016](./0016-aceite-do-convite-vinculo-e-consentimento.md)); o que não existia
era por onde o paciente entra. Os critérios de aceite dizem três coisas — o
fluxo funciona nas duas plataformas, não dá para avançar sem os consentimentos
obrigatórios, e convite inválido mostra mensagem clara.

Quatro perguntas ficaram abertas, e cada uma tem consequência fora deste card:

1. **Que link abre o app?** O link que o nutricionista manda por WhatsApp
   aponta para o painel (`/convite?token=...`, ADR
   [0015](./0015-convite-por-link-com-token-hasheado.md)), e o painel é web.
2. **Quem lê esse link dentro do app?** Flutter tem deep link embutido;
   o ecossistema tem plugins que fazem o mesmo.
3. **De onde sai o texto do termo e a versão?** A API decide a versão que
   **registra** (`CURRENT_TERMS_VERSION`) e não a expõe em lugar nenhum — ADR
   0016 deixou isso explicitamente para o card do versionamento dos termos.
4. **Como a última tela diz "Você está conectado a [nutricionista]"?** A
   resposta do aceite carrega ids e nenhum nome, por decisão do ADR 0016.

## Decisão

**O app abre em `fitapp://convite?token=<token>`, um esquema próprio.** Não é
App Link nem Universal Link sobre o domínio do painel, que é o que abriria o app
a partir do link que já é enviado hoje: os dois exigem um arquivo de associação
servido por aquele domínio (`assetlinks.json`, `apple-app-site-association`), o
que é infraestrutura que este card não tem — e link que não verifica abre o
navegador **sem dizer nada**, que é o pior dos dois mundos. O formato do link
enviado não muda: quem abre no celular cai no painel, e é o painel que vai
oferecer o app. O dia em que houver domínio verificado, `isInvitationLink` já
reconhece a URL do painel e nada mais muda.

**O deep link é o do próprio Flutter, sem plugin.**
`flutter_deeplinking_enabled` no `AndroidManifest.xml` e
`FlutterDeepLinkingEnabled` no `Info.plist`: o motor entrega a uri como rota, o
`go_router` responde, e quem decide para onde o link vai continua sendo
`router.dart` — um lugar só, o mesmo que já decide o que exige sessão. Um
plugin de deep link seria uma dependência nova para entregar a mesma uri por
fora do router, com duas coisas navegando.

Isso traz um detalhe que **tem** de estar escrito em algum lugar: as duas
plataformas não entregam o link na mesma forma. Android passa o caminho e a
query da intent e **descarta o host**, então `fitapp://convite?token=abc` chega
como `/?token=abc`; iOS passa o endereço inteiro. `invitationLocationFor`, no
`router.dart`, é o único lugar que sabe disso, e normaliza as duas formas (e a
URL do painel) para `/convite?token=abc`. É também por isso que o redirect do
router lê `state.uri` e não `state.matchedLocation`: uma uri com host e sem
caminho não casa com rota nenhuma.

**`/convite` é a única rota que responde com e sem sessão.** O paciente chega
sem conta e é autenticado no meio do fluxo; um redirect para a home no instante
em que a sessão nasce jogaria a pessoa para fora do próprio onboarding, uma tela
antes dos consentimentos. A lista `publicPaths` continua fechada, e
`sessionAgnosticPaths` tem um item só.

**Uma tela por finalidade, com o texto inteiro e a versão.** Quatro telas, na
ordem em que a plataforma fala delas, cada uma com o termo na tela — nunca atrás
de um link — e a versão escrita embaixo. Para as duas obrigatórias **não existe
botão que avance** enquanto a caixa não for marcada: é o critério de aceite
escrito como estado do botão, e não como mensagem depois do toque. A recusa que
vale continua sendo a da API (422), que vale para qualquer cliente.

**O texto e a versão do termo moram no app, por enquanto.** São o gêmeo em Dart
de `CURRENT_TERMS_VERSION`, como o filtro do Sentry é o gêmeo de
`@fit-app/observability`: o app não importa TypeScript, e não há endpoint que
responda o termo vigente. A assimetria é deliberada e segura numa direção — o
que fica **registrado** é sempre a versão que a API serviu, nunca uma que o
cliente mandou (ADR 0016), então um app desatualizado pode mostrar um número
velho, mas não pode registrar concordância com texto que ninguém serviu.

**A resposta do aceite passa a carregar o nome da prática**
(`organizationName`), e isto reverte uma frase do ADR 0016. A última tela do
onboarding existe para dizer a quem o paciente se conectou, e id não se lê em
voz alta. Não é dado de terceiro para quem está lendo: é a parte com quem a
pessoa acabou de se vincular, e para profissional solo é o nome dele (ADR
[0014](./0014-modelo-de-identidade-e-organizacao-solo.md)). O ADR 0016 remetia
esse nome ao `GET /v1/me` do paciente, que não existe — e criá-lo para uma
palavra numa tela seria um endpoint a mais para a mesma resposta. Nenhum outro
nome entra: nem o do paciente, nem o de quem convidou.

Ficam **explicitamente de fora**:

- **O fuso horário do paciente.** O aceite não manda `timeZone`: o aparelho sabe
  o deslocamento, não o nome IANA, e um fuso errado é o que data errado uma
  noite de sono. A API aplica o padrão da plataforma, e escolher o fuso é a tela
  de perfil.
- **Confirmação de e-mail dentro do fluxo.** Se o projeto do Supabase exigir
  confirmação, não há sessão e portanto não há aceite: a tela diz para confirmar
  o e-mail e abrir o link de novo.
- **Recuperar o convite depois de criar a conta.** O token vive no estado da
  tela; fechar o app no meio é abrir o link outra vez.

## Consequências

- O app tem a primeira tela que não é só leitura, e ela não ganhou nenhuma
  dependência nova: `pubspec.yaml` está igual.
- O que é regra continua na API. O app recusa um código impossível (tamanho, e
  nada mais — ADR 0015 manda não saber o formato) e exige as duas finalidades
  obrigatórias antes de chamar; tudo o mais — convite usado, revogado, expirado,
  conta de profissional — é mensagem da API mostrada como veio, em pt-BR e sem
  dado de paciente, como o contrato garante.
- **Convite inválido só é descoberto depois da conta criada**, quando o token é
  plausível: não existe rota que valide um convite sem autenticação, e criar uma
  seria dar a quem tem um token um jeito de confirmá-lo sem deixar rastro. A
  conta criada continua servindo, e a pessoa tenta outro código sem sair da
  tela.
- `apps/mobile` continua fora do CI (ADR
  [0010](./0010-ci-no-github-actions.md)): `flutter analyze` e `flutter test`
  são o que vale antes de empurrar, e os testes deste card são as funções puras
  do link, a lista de finalidades e a tela de consentimento — o fluxo inteiro,
  que fala com o Supabase, não tem teste de widget.
- Quem muda `CURRENT_TERMS_VERSION` na API tem de mexer em `consent_terms.dart`
  no mesmo PR. É disciplina, e some no dia em que um endpoint responder o termo
  vigente.
- O esquema `fitapp://` não é exclusivo de ninguém: outro app pode declarar o
  mesmo e disputar o link. É o limite conhecido de esquema próprio, e a saída é
  o App Link verificado, que não muda nenhuma linha de Dart.
