# 0001. Monólito modular com NestJS e clean architecture pragmática

- **Status:** aceito
- **Data:** 2026-10-08

## Contexto

A plataforma tem quatro áreas de domínio bem distintas — identidade, nutrição,
dados de saúde e insights — e uma equipe muito pequena. O produto ainda vai mudar
de forma várias vezes antes do beta, então as fronteiras entre essas áreas são
palpites informados, não certezas. Precisamos de uma arquitetura que deixe essas
fronteiras visíveis e corrigíveis sem pagar o custo operacional de distribuir o
sistema cedo.

## Decisão

Uma única aplicação NestJS em TypeScript `strict`, organizada em módulos de
domínio: `identity`, `nutrition`, `health` e `insights`.

Cada módulo tem quatro camadas: `domain/` (entidades, value objects e regras
puras, sem NestJS, sem banco, sem I/O), `application/` (um arquivo por caso de
uso, mais as portas para fora), `infrastructure/` (repositórios Drizzle,
adaptadores, jobs) e `presentation/` (controllers, DTOs, guards).

A fronteira é explícita: um módulo só importa o `index.ts` de outro, nunca um
arquivo interno. Efeitos colaterais entre módulos passam por eventos internos
nomeados `<modulo>.<entidade>.<fato no passado>`.

Clean architecture aqui é pragmática, não dogmática: portas existem para o que
pode mudar de fornecedor (wearables, IA, fila, e-mail, push, pagamento), e o
banco não recebe abstração tabela a tabela.

Fica de fora: microsserviços, Kubernetes, Kafka, Redis e GraphQL.

## Consequências

Um artefato para construir, testar e implantar, e refatorar fronteira entre
módulos é mover arquivos em vez de coordenar serviços e versões de API.

Em troca, nada no runtime impede um import indevido — a fronteira depende de
disciplina e de revisão de PR. Vale avaliar uma checagem automática de limites
de módulo quando o repositório crescer.

O `domain/` puro é o que torna cálculo de macros e regras de alerta testáveis
sem banco nem rede, e é onde os testes unitários são obrigatórios.

Partir para microsserviços exige um ADR novo que mostre o gargalo concreto que
o monólito não resolveu.
