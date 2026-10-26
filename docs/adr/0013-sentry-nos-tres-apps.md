# 0013. Sentry nos três apps, com o filtro de dado sensível num pacote só

- **Status:** aceito
- **Data:** 2026-10-20

## Contexto

Log a gente tem desde o [ADR 0006](./0006-logger-estruturado-com-pino.md): uma
linha JSON por evento no stdout, com redação por nome de campo. O que falta é o
outro lado — saber que **quebrou**, sem alguém estar olhando o CloudWatch na
hora, e com a pilha junto. No painel e no app não há nem isso: um erro no
navegador ou no aparelho de um paciente hoje não deixa rastro em lugar nenhum.

O `CLAUDE.md` ("Saúde e LGPD") não abre exceção para relatório de erro: nome,
e-mail, telefone, nota e valor de check-in não saem da plataforma, e a regra
vale para o Sentry pelo nome. Só que um SDK de erro é, por projeto, o oposto
disso: ele junta corpo de requisição, cabeçalho, cookie, query string, variável
local de quadro de pilha, e enfeita a issue com o e-mail e o nome do usuário.
Ligado com o padrão de fábrica, ele é o maior vazamento de dado de saúde que
esta plataforma teria.

O card F-16 pede as três pontas — API, painel e app — com ambiente e versão,
`beforeSend` que tira dado pessoal e de saúde, e usuário identificado só por id.

## Decisão

**Sentry nos três, e o mesmo filtro nos três.** O que pode sair de um evento é
uma regra da plataforma, não de cada aplicação.

**Duas camadas, e elas não são redundantes.** A primeira diz ao SDK o que
**nunca coletar** (no Node e no navegador, `dataCollection`; no app, as opções
equivalentes): corpo, cookie, cabeçalho, query string, parâmetro de query do
banco, payload de job, variável local. Dado que nunca foi coletado não vaza por
um caminho que ninguém revisou. A segunda é o `beforeSend`, que roda por
último, no evento prestes a sair, e mascara o que sobrou **por nome de campo** —
é o que pega o campo que uma integração nova trouxe e este ADR não previu.

**O filtro mora em `packages/observability`,** junto da lista de campos
sensíveis que o logger da API já lia. Uma lista só, porque campo que é dado
pessoal em linha de log é dado pessoal em relatório de erro. O pacote não tem
dependência e não faz I/O; o tipo do evento é declarado estruturalmente, e não
importado do `@sentry/core`, para o mesmo arquivo servir ao `@sentry/node` e ao
`@sentry/nextjs` — e para uma mudança de forma numa versão futura quebrar o
build em vez de vazar.

**O app carrega uma cópia em Dart,** em `apps/mobile/lib/src/core/observability/`.
Não dá para importar TypeScript de dentro do Flutter, e as alternativas —
gerar Dart a partir do TypeScript, ou um serviço no meio — custam mais do que
duas listas que mudam juntas. Os nomes estão na mesma ordem nos dois arquivos,
de propósito: um diff entre eles tem de ser legível.

**O que sai de um evento, nos três:**

| Parte                       | O que sobra                                                   |
| --------------------------- | ------------------------------------------------------------- |
| `user`                      | só o `id`; sem id, o usuário todo sai                         |
| `request`                   | método e caminho; sem corpo, cookie, header ou query          |
| `message`, `exception`      | o tipo fica, o texto vira `[redacted]`                        |
| quadros da pilha            | arquivo, linha e código-fonte ficam; variáveis locais não     |
| `breadcrumbs`               | categoria, status e endereço; texto e dados fora da lista não |
| `extra`, `contexts`, `tags` | máscara por nome de campo, a mesma do log                     |

Texto livre é mascarado porque quem escreveu a mensagem pode ser o driver do
banco, e mensagem de Postgres cita o valor que quebrou a query (`Key
(email)=(...) already exists`) — o mesmo motivo de `safe-error.ts` na API. Tipo,
pilha e código dizem onde quebrou, que é o que depurar precisa.

**Ambiente e versão são obrigatórios juntos com o DSN.** Sem o ambiente não dá
para distinguir uma queda em homologação de uma que um paciente acabou de
levar; sem a versão não dá para saber se o bug ainda está no ar. Na API, ter
`SENTRY_DSN` torna `SENTRY_RELEASE` obrigatória e a API **não sobe** sem ela —
o ambiente cai para o `NODE_ENV`, porque a task de homologação roda com
`NODE_ENV=production` e precisa aparecer como `staging`. No painel e no app a
ausência da versão não impede nada: painel que não abre é pior que issue sem
versão.

**Sem DSN, ninguém reporta.** É o padrão em máquina de desenvolvimento e no CI:
o erro fica no log e mais nada.

**Só erro inesperado.** Na API, quem reporta é o filtro global, no ramo do 500.
Erro de domínio e `HttpException` (404, 403, 422) são respostas que a API dá de
propósito — mandá-las afogaria a falha de verdade e colocaria um rastreador de
bug entre o nutricionista e uma mensagem de validação.

**Ficam de fora, e não por esquecimento:**

- **Tracing.** Amostrar requisição e navegação é outra decisão, com outro custo,
  e um span carrega rota e query de tudo que o sistema faz. `tracesSampleRate`
  fica em zero nos três.
- **Session replay** (painel e app). Grava a tela. Numa tela que mostra
  paciente, isso é vídeo de dado de saúde saindo do navegador ou do aparelho.
  No app, `attachScreenshot` e `attachViewHierarchy` são a mesma coisa em foto e
  em texto, e ficam escritos como desligados mesmo sendo o padrão do SDK:
  padrão não é decisão.
- **`@sentry/nestjs`.** O `@sentry/node` mais o filtro global que já existe dão
  o mesmo resultado com uma dependência a menos, e com a decisão de _o que_
  reportar escrita no nosso código.
- **Alerta, dashboard e quota.** São configuração do projeto no Sentry, não
  código deste repositório.

**Uma rota, uma página e um botão provocam um erro de propósito,** fora de
produção: `GET /v1/debug/sentry` na API (404 em produção, e nunca no OpenAPI),
`/debug/sentry` no painel (dentro de `(painel)`, então atrás da sessão) e um
botão na barra da tela inicial do app, ao lado do selo de ambiente. A mensagem
dos três leva nome, e-mail e peso sintéticos: o que o conferente precisa ver na
issue não é que o evento chegou, é que chegou com `[redacted]` no lugar dos
três.

## Consequências

Um campo sensível novo continua sendo **uma linha** em
`packages/observability/src/sensitive-fields.ts` — e agora vale para o log da
API, para a issue da API, para a do painel e, com a linha gêmea em Dart, para a
do app.

Em troca, a máscara erra para o lado dela: o `runtime.name` que o SDK anexa sai
como `[redacted]`, porque "name" é nome sensível. Custa a palavra "node" numa
issue; o contrário custaria um e-mail.

Duas listas para manter em dia (TypeScript e Dart). Um teste em cada lado prova
o que cada uma decide, e os dois arquivos se citam no comentário de cabeçalho —
mas nada impede, hoje, que alguém mexa em um e esqueça o outro. Se isso
acontecer uma vez, o próximo passo é gerar o Dart a partir do TypeScript, e aí
vira ADR novo.

O app ganhou uma dependência nova (`sentry_flutter`), que traz os SDKs nativos
de Android e iOS junto — é a primeira dependência do app com código nativo, e a
build de iOS passa a baixá-la pelo Swift Package Manager.

A pilha do painel só é legível em produção se a build subir os source maps, o
que depende de `SENTRY_ORG`, `SENTRY_PROJECT` e `SENTRY_AUTH_TOKEN` existirem no
ambiente da build da Vercel. Sem eles o `withSentryConfig` pula o envio, a build
passa, e a issue mostra nomes de variável de um caractere.

**O que não fecha com este ADR:** ninguém é avisado de nada ainda. Issue criada
não é alerta, e quem recebe e-mail de quê é configuração do projeto no Sentry,
que é um passo de operação, não de código.
