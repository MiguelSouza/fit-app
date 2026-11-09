# 0019. Registro de acessos: tabela append-only, um registro por visita e página por cursor

- **Status:** aceito
- **Data:** 2026-11-09

## Contexto

O card I-06 fecha o módulo `identity`: a LGPD dá ao titular o direito de saber
quem acessou os dados dele, e o `CLAUDE.md` já obriga a "registrar acesso
(`identity.logAccess`) ao abrir a ficha de um paciente ou exportar dados". O
card pede três coisas: o serviço público `logAccess(actorId, patientId,
resource, action)`, a chamada dele ao abrir a ficha e em qualquer exportação, e
`GET /me/access-log` paginado para o paciente.

A ADR [0017](./0017-servico-de-acesso-ao-paciente.md) deixou o lugar marcado e
disse o contrário do que esta decide num ponto: "o guard, que já sabe
profissional, paciente e rota, é onde ele vai entrar". O que ela acertou foi o
motivo de não misturar as duas coisas — "checagem de autorização também roda em
requisições que não são 'abrir a ficha', e conflatar as duas gera um registro
que mente". Levado a sério, esse mesmo argumento tira o registro do guard: o
guard roda em **toda** rota que carrega um paciente.

Seis decisões não são óbvias:

1. **Onde a chamada acontece**, já que "abrir a ficha" é uma tela com várias
   requisições e o critério de aceite é **exatamente um registro por visita**?
2. **Antes ou depois do handler**, e o que acontece se o registro não puder ser
   gravado?
3. **O que impede que um registro seja editado ou apagado?**
4. **O que o paciente vê de quem acessou** — id, nome, profissão?
5. **Como se pagina** uma lista que só cresce e é lida do mais novo para o mais
   antigo?
6. **Quem é "o quê"**: texto livre ou vocabulário fechado?

## Decisão

**A rota que é a visita se declara, e só ela.** `@RecordsPatientAccess('patient_chart',
'view')` marca a rota que **é** abrir a ficha; as outras requisições da mesma
tela não levam o decorator e não geram linha nenhuma. É assim que "exatamente
um registro por visita" é verdade sem nenhuma janela de deduplicação — e sem
janela de propósito: duas visitas são dois fatos, mesmo com dez segundos entre
elas, e esconder a segunda seria mentir para o único leitor que esta tabela
tem. O decorator anda junto do `@RequiresPatientAccess()`: um registra, o outro
autoriza, e a rota que registra sem exigir é uma rota que anota um acesso que
não checou.

**Interceptor e não guard**, pelo argumento da ADR 0017 levado até o fim. E
interceptor **depois** do handler: a linha entra quando a resposta foi
produzida, então requisição recusada (404 da regra de acesso) e handler que
quebrou (500) não deixam registro — o que a lista diz é o que foi realmente
visto.

**A gravação é aguardada e falha fecha a requisição.** Se o registro não pode
ser escrito, o profissional recebe 500 em vez da ficha. É a leitura LGPD do
trade: acesso que ninguém consegue provar é pior do que acesso que não
aconteceu. Em troca, uma indisponibilidade da tabela derruba a ficha — e é
disso que se trata.

**`AccessLogService.logAccess(...)` sai pelo `index.ts`**, ao lado do
`PatientAccessService`, porque HTTP não é o único caminho: exportação feita em
job, worker ou caso de uso chamado por outro não tem `ExecutionContext`, e
chama o serviço na mão. Um módulo que escrevesse a própria tabela seria um
segundo vocabulário e, um ano depois, um "quem viu meus dados" pela metade.

**`resource` e `action` são enums fechados, no domínio, no contrato e no
banco** (`patient_chart`; `view` e `export`). A tela do paciente precisa de um
código para traduzir, não de uma frase que a API escreveu, e registro só é
auditável enquanto as palavras dele querem dizer uma coisa só. Hoje há um
`resource` porque há uma coisa que abre um paciente; `export` já é um valor
porque o card pede "qualquer exportação" e exportação **não** é um tipo de
`view` — ela deixa cópia do dado fora da plataforma, que é a parte que mais
importa ao titular.

**A tabela é append-only e quem diz isso é o Postgres.** A porta
`AccessLogRepository` tem dois métodos (`append` e `findPage`) e não existe
`update` nem `delete` desta tabela em arquivo nenhum; além disso a migração
`0004` põe um gatilho que recusa `update`, `delete` e `truncate`, por
statement, inclusive quando o `where` não casa com nada. É o critério de aceite
"registros não podem ser editados nem apagados pela API" decidido pelo banco, e
não por convenção: trilha que depende de o código se comportar é trilha que uma
consulta distraída desfaz. **Por causa do gatilho, as duas chaves estrangeiras
não são `cascade`** — seriam um `delete` que a tabela recusa, no meio de outra
operação.

**O paciente vê o nome de quem acessou, e a profissão.** "Quem viu meus dados"
não se responde com um id. É o único dado pessoal que esta rota devolve, é
sobre o profissional e não sobre outro paciente, e quem pergunta é o próprio
titular. `professionalType` vem junto para o paciente distinguir a
nutricionista que prescreve do treinador da mesma prática. Nada disso vai para
log nenhum (`CLAUDE.md`, "Saúde e LGPD"): os três arquivos do caminho não têm
uma linha de log.

**`GET /v1/me/access-log`, sob `me` e sem id de paciente em lugar nenhum.** O
sujeito é o `sub` do token verificado (ADR
[0007](./0007-autenticacao-por-jwt-do-supabase.md)), então "paciente vê só os
próprios registros" é estrutural e não uma checagem que alguém precisa lembrar
de fazer. Profissional chamando recebe 403. A rota **não** pede consentimento
nem vínculo: saber quem tocou nos seus dados não é uma finalidade que se
consente, é o direito que dá sentido às finalidades — e quem acabou de revogar
tudo é justamente quem mais vem olhar.

**Página por cursor opaco, do mais recente para o mais antigo.** O cursor
carrega o par `(occurred_at, id)` em base64url, e a comparação no SQL é sobre
esse par, que é exatamente o índice da tabela. `limit`/`offset` estava fora de
questão: o log só cresce, e uma página por deslocamento escorrega entre duas
requisições — a linha pulada seria o acesso que o paciente nunca viu. O cursor
é opaco porque o formato é nosso: cliente que soubesse lê-lo começaria a
fabricá-lo. Cursor que não é desta API responde **400**
(`identity.access_log.invalid_cursor`) e nunca uma página vazia, que diria ao
paciente que a lista acabou onde houve um erro de digitação.

**O paciente nunca é o ator do próprio registro.** `accessToLog` recusa os dois
ids iguais, e é `Error` e não erro de domínio: é bug de quem chamou, não
negativa. Uma linha dizendo que o paciente viu os próprios dados seria mentira
sobre a única coisa que esta lista existe para contar.

## Consequências

- `nutrition`, `health` e `insights` ganham uma segunda linha para escrever na
  rota que abre uma ficha: `@RequiresPatientAccess()` **e**
  `@RecordsPatientAccess('patient_chart', 'view')`. Quem exporta fora de HTTP
  injeta `AccessLogService`.
- **Nenhuma rota de ficha nasce nesta entrega.** Os três módulos ainda são
  esqueletos, então hoje nada no ar chama o interceptor: a rota que prova o
  critério vive no teste (`patient-access-log.interceptor.spec.ts`), sobre o
  `IdentityModule` real, como o guard da ADR 0017 fez antes. O que entra no
  OpenAPI é só `GET /v1/me/access-log`.
- **Exportação ainda não existe em lugar nenhum da API.** O vocabulário
  (`export`), o serviço e o decorator estão prontos e testados; a primeira
  exportação de verdade — PDF do plano, CSV dos check-ins — nasce no card dela
  e já tem onde se registrar.
- **Apagar um `profile` que aparece no log passa a falhar.** É consequência
  direta de as chaves não serem `cascade`, e é o comportamento desejado: quem
  decide o que fazer com a trilha é o card de eliminação de dados — outro
  direito, outras consequências —, não um `cascade` que ninguém revisou.
- **Retenção não existe.** As linhas ficam para sempre, e apagá-las exige ser
  dono da tabela e derrubar os gatilhos numa migração revisada. É o caminho
  certo para uma decisão de produto, e é caro de propósito.
- A tela do app do paciente ("quem viu meus dados") e a do painel ficam para os
  cards de interface; o cliente Dart e o TypeScript já são gerados com a
  operação.
- O profissional não é avisado de que o acesso dele é registrado, nem vê a
  própria trilha. Avisar é produto, e tem decisão própria.
- Dois registros no mesmo milissegundo são ordenados pelo id, que é o que o
  índice e o cursor carregam. Não é cosmético: sem isso uma página repetiria ou
  pularia uma linha, que é exatamente a linha que ninguém veria.
- O interceptor resolve o profissional de novo, depois de o guard já ter
  resolvido na mesma requisição: uma consulta por chave primária a mais. Se
  virar problema, o lugar de resolver é o guard guardar o id resolvido na
  requisição — e isso é uma mudança pequena, não um ADR novo.
