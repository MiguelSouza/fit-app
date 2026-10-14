# Módulos de domínio

Os quatro módulos de `CLAUDE.md` ("Módulos de domínio"). Cada um é dono de um
schema do Postgres e só é visto de fora pelo próprio `index.ts`.

| Módulo      | Schema      | Responsável por                                                                |
| ----------- | ----------- | ------------------------------------------------------------------------------ |
| `identity`  | `identity`  | pessoas, organizações, vínculos, convites, consentimentos, registro de acessos |
| `nutrition` | `nutrition` | alimentos, planos, refeições, opções, cálculo de macros, adesão                |
| `health`    | `health`    | conexões de wearable, atividades, sono, métricas diárias, check-ins, medidas   |
| `insights`  | `insights`  | regras de alerta, alertas, resumos por IA, intervenções, linha do tempo        |

Por enquanto cada módulo tem só o `<modulo>.module.ts` e o `index.ts` — a
exceção é `identity`, que já responde o `GET /v1/me` provisório do card F-09. O
resto do conteúdo entra pelos cards de cada domínio; as pastas das quatro camadas
já existem, com um `.gitkeep` cada, porque o git não versiona pasta vazia.

## As camadas

```
<modulo>/
  domain/          entidades, value objects, regras puras. Sem NestJS, sem banco, sem I/O
  application/     casos de uso (um arquivo por caso de uso)
    ports/         interfaces para o que pode mudar (fornecedor, fila, e-mail)
  infrastructure/  repositórios Drizzle, adaptadores de fornecedores, jobs
  presentation/    controllers, DTOs (de packages/contracts), guards
  <modulo>.module.ts
  index.ts         API pública do módulo
```

## O exemplo a copiar

[`src/health-check`](../health-check) é uma fatia completa das quatro camadas, com
um teste em cada uma, e é de lá que se copia o padrão:

| Camada               | Arquivo                                              | O que mostra                                               |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------- |
| `domain/`            | `domain/system-health.ts`                            | regra pura, testada sem framework                          |
| `application/`       | `application/check-system-health.use-case.ts`        | caso de uso que depende de uma porta, não de um fornecedor |
| `application/ports/` | `application/ports/database-status.port.ts`          | interface + token de injeção                               |
| `infrastructure/`    | `infrastructure/postgres-database-status.checker.ts` | adaptador que implementa a porta                           |
| `presentation/`      | `presentation/health.controller.ts`                  | controller fino: chama o caso de uso e devolve DTO         |

`health-check` não é um módulo de domínio e por isso mora fora daqui: ele
responde pelo `GET /v1/health`, que é estado do processo e do banco. O módulo
`health` é outra coisa — é o dado de saúde do paciente (sono, atividade,
check-in).

## A fronteira

De dentro de um módulo, os outros três existem só pelo `index.ts`:

```ts
// certo
import { IdentityModule } from '../identity';

// errado: o eslint quebra o build
import { PersonRepository } from '../identity/infrastructure/person.repository';
```

Quem garante isso é o `@fit-app/config/eslint/api`, e precisar de dado de outro
módulo significa chamar o serviço público dele ou reagir a um evento
(CLAUDE.md, regras 1 a 3).

## Eventos e jobs

Efeito colateral de um módulo em outro vai por evento, e trabalho pesado ou
agendado vai para a fila. Os dois estão em `shared/`, cada um atrás de uma
porta (ADR [0009](../../../../docs/adr/0009-eventos-internos-e-fila-de-jobs.md)):

| O quê   | Porta       | Onde                                |
| ------- | ----------- | ----------------------------------- |
| Eventos | `EVENT_BUS` | [`shared/events`](../shared/events) |
| Fila    | `JOB_QUEUE` | [`shared/jobs`](../shared/jobs)     |

O nome e o payload de cada evento ficam no catálogo
[`shared/events/domain-event.ts`](../shared/events/domain-event.ts), e os dos
jobs em [`shared/jobs/job-catalog.ts`](../shared/jobs/job-catalog.ts) — um
módulo acrescenta os seus lá, não num canto do próprio código. O passo a passo
está no [README da API](../../README.md#eventos-entre-módulos).

Um job que é de um módulo mora no `infrastructure/` dele, e o módulo o declara
como provider; `shared/jobs/ping.job.ts` é o exemplo a copiar. O payload de um
evento e o de um job carregam **id e código, nunca dado de saúde ou pessoal**.
