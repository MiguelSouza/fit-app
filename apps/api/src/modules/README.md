# Módulos de domínio

Os quatro módulos de `CLAUDE.md` ("Módulos de domínio"). Cada um é dono de um
schema do Postgres e só é visto de fora pelo próprio `index.ts`.

| Módulo      | Schema      | Responsável por                                                                |
| ----------- | ----------- | ------------------------------------------------------------------------------ |
| `identity`  | `identity`  | pessoas, organizações, vínculos, convites, consentimentos, registro de acessos |
| `nutrition` | `nutrition` | alimentos, planos, refeições, opções, cálculo de macros, adesão                |
| `health`    | `health`    | conexões de wearable, atividades, sono, métricas diárias, check-ins, medidas   |
| `insights`  | `insights`  | regras de alerta, alertas, resumos por IA, intervenções, linha do tempo        |

Por enquanto cada módulo tem só o `<modulo>.module.ts` e o `index.ts`: o
conteúdo entra pelos cards de cada domínio. As pastas das quatro camadas já
existem, com um `.gitkeep` cada, porque o git não versiona pasta vazia.

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
