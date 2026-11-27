# 0022. Check-in diário: o dia como endereço, a janela do próprio dia e escalas de cinco toques

- **Status:** aceito
- **Data:** 2026-11-27

## Contexto

O card P-02 abre o módulo `health` com o dado que nenhum wearable tem: quanta
energia a pessoa sentiu que teve, como acha que dormiu, que fome sentiu e o que
o intestino fez. É a primeira escrita de dado de saúde vinda do paciente, e o
critério de aceite que manda no desenho é de tempo — "completar o check-in leva
menos de 15 segundos".

Os outros dois critérios são de correção: um check-in por paciente por dia, que
atualiza em vez de duplicar; e profissional com acesso lê, sem acesso recebe 404. O segundo já tem resposta na plataforma (ADR
[0017](./0017-servico-de-acesso-ao-paciente.md)); o primeiro é uma decisão de
modelagem que ainda não existia.

Cinco perguntas ficaram abertas, e cada uma tem consequência fora deste card
porque `health` vai repeti-las em medidas, diário e sono:

1. **Como "um por dia" é garantido?** Se for regra em código, duas requisições
   simultâneas criam duas linhas.
2. **Que dia é "hoje"?** O servidor está em UTC e o paciente, não. Uma terça
   lida no fuso errado é a terça de outra pessoa.
3. **Até quando o check-in de um dia pode ser escrito?** O card diz "editável no
   mesmo dia" e não diz o que acontece depois.
4. **Sintomas são texto livre ou vocabulário fechado?** O card pede "lista de
   opções + outro".
5. **O que o evento `health.checkin.recorded` carrega?** Quem reage a ele é
   `insights`, que ainda não existe.

## Decisão

**O dia é o endereço do recurso: `PUT /v1/me/checkins/{date}`.** Não `POST` com
a data no corpo. O dia no caminho é o que torna a requisição idempotente — mandar
duas vezes salva um check-in —, e o paciente não está em lugar nenhum da
requisição: é o `sub` do token verificado (ADR
[0007](./0007-autenticacao-por-jwt-do-supabase.md)), então não existe campo que
um cliente possa apontar para outra pessoa. Preencher e corrigir são a mesma
rota, e o app usa a mesma tela e o mesmo botão para as duas.

**"Um por dia" é um índice único no banco, não uma regra em código.** O par
`(patient_profile_id, date)` é único e a escrita é um upsert. Checar antes de
inserir seria a mesma coisa em quase todos os casos e duas linhas nos que
importam — toque duplo, retry de rede, duas abas —, porque nada entre o `SELECT`
e o `INSERT` impede a outra requisição. As três escalas também são `CHECK` de 1 a
5 na tabela, e `other_symptom` só existe quando `other` está na lista: a coluna
não aceita um estado que o domínio recusa.

**A data é `YYYY-MM-DD` em texto, e não um instante.** Nem `date-time`, nem o
formato `date` do JSON Schema — este último viraria o tipo de data de cada
cliente gerado, que é um timestamp com outro nome. Um check-in pertence a um dia
da vida do paciente, lido no **fuso do perfil** (`CLAUDE.md`, "Dados de saúde"),
e um instante carregaria uma meia-noite e um deslocamento que ninguém escolheu:
o primeiro cliente a interpretá-lo no próprio fuso mudaria a terça de alguém para
segunda. É o mesmo raciocínio que data uma noite de sono pelo dia em que começou.
Se aqueles dígitos nomeiam um dia que existe é o domínio que responde —
`2026-02-31` casa com o padrão e não é um dia.

**A janela de escrita é o próprio dia, no fuso do paciente.** Não um número de
horas depois dele, nem "até o próximo ser preenchido": um check-in é alguém
dizendo como **hoje** foi, e uma terça preenchida na sexta é memória, que é um
tipo de dado muito pior para pendurar um acompanhamento. Dia passado e dia futuro
respondem 422 — o segundo pela razão mais simples, não aconteceu. Nada impede o
paciente de contar da terça ao nutricionista: isso é uma nota, e fica datada
honestamente. Para ler o fuso, `identity` passou a responder quem está chamando
(`LoadPatientCaller`), porque a coluna é dele e nenhum outro módulo lê a tabela
de outro (regra 2).

**Os sintomas são um vocabulário fechado, com `other` ao lado de um
`otherSymptom` curto.** Texto livre guardaria quatro grafias de "inchaço" em um
mês, e um sintoma só é comparável entre semanas enquanto a palavra para ele quer
dizer uma coisa. O fio carrega código e a tela mostra pt-BR, então a lista é
traduzível e o histórico continua contável. `other` é a saída que o card pede, e
não um campo de texto livre com outro nome: um código que não para de aparecer em
`other` é a deixa do produto para virar chip. Valor novo é **apenas acrescentado**
à lista, nunca reusado nem reordenado — os códigos estão no banco e em um ano de
histórico de alguém.

**A tela são três escalas de cinco botões, chips e a nota por último.** Cinco e
não dez: a pessoa responde tocando em um de cinco, e uma fileira de dez alvos é
uma fileira que ninguém acerta na primeira — que é a diferença entre dez segundos
e trinta. Botões e não slider: um slider pede um toque, um arrasto e uma soltura
para responder uma escala, erra quando o dedo escorrega e não é lido como cinco
opções por um leitor de tela. Cada alvo carrega a **palavra** do seu valor como
rótulo de acessibilidade — "Boa", não "4". Um dia sem nada a relatar são **quatro
toques** (energia, sono, fome, salvar), sem rolagem até o botão e sem teclado no
caminho: o critério dos 15 segundos decidido no layout, não esperado dele.

**O evento carrega ids, um dia e um instante — e `corrected`.** Nem energia, nem
fome, nem sintomas e muito menos a nota: o payload é lido por handlers que podem
logá-lo, enfileirá-lo ou entregá-lo a um fornecedor, e aquilo é dado de saúde
(`CLAUDE.md`, "Saúde e LGPD"). Quem precisar das respostas pede a `health`, com a
checagem de consentimento que vem junto. É um evento por salvamento e não um por
dia, porque uma correção é um fato novo sobre o mesmo dia; `corrected` é o que
permite distinguir os dois, para que o que um dia notificar alguém não notifique
duas vezes porque um toque foi consertado. É publicado **depois** da escrita.

**A leitura do profissional é `GET /v1/patients/{id}/checkins`, com período
obrigatório.** A autorização é a regra do `identity` e nada mais — vínculo ativo
**e** consentimento `share_with_professional` vigente, lido no instante da
requisição (ADR 0017) —, e é pedida **dentro do caso de uso**, mesmo com a rota
atrás de `@RequiresPatientAccess()`: um guard responde por uma requisição HTTP, e
um job chamando o mesmo caso de uso não tem guard. Toda recusa é 404, pela decisão
do próprio serviço, então tentar ids não lista os pacientes da plataforma. A
visita é registrada como `patient_checkins`, recurso próprio e não o da ficha,
para que a lista do paciente diga o que de fato aconteceu. O período é limitado a
366 dias: uma janela sem teto é uma varredura de histórico de saúde numa
requisição.

Ficam **explicitamente de fora**:

- **A tela do profissional no painel.** O card pede API e app; a rota existe,
  testada, e quem a desenha é o card da ficha do paciente.
- **Qualquer média, tendência ou alerta.** `4` de energia não é o dobro de `2` —
  é a quarta de cinco palavras —, então nada na plataforma faz média disso por
  conta própria. Tendência de uma semana é regra de `insights`, com card próprio.
- **Lembrete ou notificação para preencher.** Não há push na plataforma ainda, e
  a janela de um dia torna o lembrete um produto, não um detalhe.
- **Histórico no app.** `GET /v1/me/checkins` existe e a tela usa só o de hoje,
  para abrir preenchida; a lista de dias é outro card.
- **O fuso escolhido pelo paciente.** O app manda o dia do **aparelho**: Dart
  converte um instante para o fuso local e para nenhum outro por nome, e a base
  IANA seria dependência sem decisão atrás. Aparelho e perfil discordando já é
  seguro — a API recusa com `health.checkin.window_closed`, a tela mostra a
  mensagem, e nada é escrito sob o dia errado.

## Consequências

- `health` é o segundo módulo com as quatro camadas preenchidas, e o primeiro a
  depender de `identity` em tempo de execução: pelo `index.ts` dele e por três
  serviços (`LoadPatientCaller`, `LoadProfessionalCaller`, `PatientAccessService`).
  A fronteira continua de pé e o lint continua guardando.
- O `index.ts` de `health` **não** exporta nada do check-in, de propósito. Quem
  vai lê-los é `insights`, e o que ele escuta é `health.checkin.recorded` (regra
  3). O dia em que algo tiver de perguntar em vez de reagir, aparece ali um
  serviço com a checagem de consentimento dentro — nunca um repositório.
- A janela de um dia é a decisão mais fácil de contestar deste ADR, e a mais
  fácil de reverter: é uma função pura (`isCheckinWindowOpen`) com teste próprio.
  O que não se reverte é o contrário — dado de memória já gravado como se fosse
  do dia.
- Normalizar em um lugar só (ordem do vocabulário, duplicatas, `trim`, vazio
  virando `null`) é o que faz as mesmas respostas produzirem a mesma linha
  qualquer que seja o cliente. Sintoma ausente é lista vazia, que quer dizer
  "nada a relatar" e **não** "não respondi" — não existe como dizer o segundo, e
  o dia em que isso importar é uma coluna nova, não uma reinterpretação do vazio.
- `apps/mobile` continua fora do CI (ADR [0010](./0010-ci-no-github-actions.md)):
  `flutter analyze` e `flutter test` são o que vale antes de empurrar, e os testes
  deste card são as funções puras do dia, os rótulos e a tela inteira em widget
  test.
- O teste de integração do caso de uso precisa de Docker (Testcontainers), como
  os do `identity`. Em máquina sem Docker ele não roda, e é o `pnpm test` que
  passa.
