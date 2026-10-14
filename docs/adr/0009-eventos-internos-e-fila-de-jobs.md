# 0009. Eventos internos em memória e fila de jobs com pg-boss

- **Status:** aceito
- **Data:** 2026-10-14

## Contexto

O `CLAUDE.md` já diz duas coisas que precisavam de forma concreta. A regra 3
manda que efeito colateral entre módulos vá por **evento**
(`<modulo>.<entidade>.<fato no passado>`), porque a regra 1 proíbe um módulo de
importar código interno de outro e a 2 proíbe ler a tabela dele. E a tabela de
stack escolhe **pg-boss** para job, sem dizer como ele aparece no código.

O trabalho que o produto já prevê é dos dois tipos. Ativar um plano tem que
acordar `insights`, e isso é imediato, pequeno e no mesmo processo. Receber uma
noite de sono do agregador, pedir um resumo para o fornecedor de IA ou
reprocessar as regras de alerta de um paciente é outra coisa: é lento, depende
de servidor de terceiro, falha de vez em quando e precisa sobreviver a um
deploy.

Misturar os dois num mecanismo só custa caro dos dois lados. Um barramento que
persiste tudo transforma uma chamada de função em uma linha de tabela; uma fila
usada como barramento faz quem publica esperar um worker.

A infraestrutura também pesa. A API é um monólito modular numa task do ECS
([0001](./0001-monolito-modular-com-nestjs.md),
[0005](./0005-aws-sa-east-1-e-vercel.md)) com um Postgres do Supabase atrás
([0002](./0002-supabase-como-infraestrutura.md)), e o `CLAUDE.md` ("Não faça")
pede ADR para trazer Redis ou Kafka.

## Decisão

São **dois mecanismos, cada um atrás de uma porta** (regra 5), em `shared/`.

**Evento é em memória.** `EventBusPort` tem `publish` e `subscribe`, e a única
implementação hoje é `InMemoryEventBus`, sobre o `EventEmitter2` do
`@nestjs/event-emitter`. Publicar **espera** os handlers, o que mantém legível a
ordem do que acontece e deixa o teste afirmar a reação sem ficar sondando; em
troca, handler é curto, e o que for lento vira job. Um handler que estoura é
linha de log, não exceção subindo para quem publicou — o alerta que falhou não
desfaz o plano que foi ativado.

Nome e payload de todo evento ficam num catálogo tipado único
(`shared/events/domain-event.ts`), e o payload carrega **id e código, nunca dado
de saúde ou pessoal**: quem precisa do dado por trás do id pede ao módulo dono,
com a checagem de consentimento que vem junto.

**Job é pg-boss**, no mesmo Postgres, no schema `pgboss`. `JobQueuePort` tem
`register` e `enqueue`; o job declara o próprio nome, a política de tentativas
(em tentativas e segundos, com backoff exponencial ou fixo) e, se for o caso, o
cron. O adaptador é quem traduz isso para as colunas do pg-boss — tentativa
vira `retryLimit`, que conta **retentativa** e por isso é uma a menos — e é o
único arquivo que conhece a biblioteca. `handle` que estoura é o que faz a fila
contar a tentativa e esperar o backoff: por isso o adaptador loga e **relança**.

`JOBS_ENABLED=false` troca a fila pela que não faz nada, para o processo que só
precisa dos módulos de pé: o jest e o passo do `pnpm api:generate` que lê as
rotas da aplicação.

Ficam **explicitamente de fora**:

- **Redis, SQS, RabbitMQ, Kafka.** Um Postgres que já existe entrega job com
  transação, retry e cron; um broker a mais é uma peça a mais para operar,
  monitorar e pagar, em sa-east-1, antes de existir volume que justifique.
- **Outbox e evento persistido.** Enquanto quem publica e quem reage estão no
  mesmo processo, um evento perdido é um processo que caiu — e o que não pode
  se perder vai para a fila, que é durável. O dia em que um evento tiver que
  sair do processo, entra um segundo adaptador da mesma porta.
- **`@OnEvent`, o decorador do `@nestjs/event-emitter`.** Assinar é uma chamada
  a `subscribe` no start do módulo. É o que mantém a dependência dentro do
  adaptador: com o decorador espalhado pelos módulos, trocar o barramento
  viraria reescrever todo subscriber.
- **Processo de worker separado.** Os workers rodam na própria task da API. Um
  serviço só para job é uma decisão de infraestrutura, e entra com os cards de
  ECS, quando houver carga para medir.

## Consequências

Um módulo passa a poder reagir a outro sem conhecê-lo, e o acoplamento vira o
catálogo de eventos — que é um arquivo revisável, onde um nome fora do padrão
quebra o teste.

Quem publica paga o tempo dos handlers. É intencional, e é a razão de handler
caro ter que virar job; não há nada que force isso além da revisão de PR.

O pg-boss cria e mantém o schema `pgboss` sozinho, fora do Drizzle Kit. É a
única exceção à regra "migração só via Drizzle Kit", e ela vale porque o schema
é da biblioteca, não nosso: nenhuma tabela de módulo mora lá e nenhum módulo lê
de lá.

Um job roda de novo depois de falhar, então todo `handle` tem que ser seguro
para rodar duas vezes com o mesmo payload. Isso é disciplina de quem escreve o
job; a fila não tem como garantir.

Trocar de fila é escrever um segundo arquivo ao lado de `pg-boss-job-queue.ts` e
mudar a linha de `jobs.module.ts` que escolhe qual construir. O que a fila nova
precisaria oferecer está escrito, em uma interface, no alto do arquivo atual.
