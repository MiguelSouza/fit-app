# Registros de decisão de arquitetura (ADRs)

Toda decisão que mude estrutura, dependência importante ou uma regra do `CLAUDE.md`
vira um ADR curto aqui, em `NNNN-titulo.md`, com contexto, decisão e consequências.
Comece a partir do [`0000-template.md`](./0000-template.md).

Um ADR aceito não é reescrito quando muda de ideia: escreva um novo e marque o
antigo como substituído por ele.

| #                                                     | Decisão                                                                         | Status |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| [0001](./0001-monolito-modular-com-nestjs.md)         | Monólito modular com NestJS e clean architecture pragmática                     | aceito |
| [0002](./0002-supabase-como-infraestrutura.md)        | Supabase como infraestrutura (Postgres, Auth, Storage); regra de negócio na API | aceito |
| [0003](./0003-wearables-via-agregador.md)             | Wearables via agregador atrás de uma porta própria                              | aceito |
| [0004](./0004-um-schema-por-modulo.md)                | Um schema Postgres por módulo                                                   | aceito |
| [0005](./0005-aws-sa-east-1-e-vercel.md)              | AWS sa-east-1 com ECS Fargate e CDK; painel na Vercel                           | aceito |
| [0006](./0006-logger-estruturado-com-pino.md)         | Logger estruturado com pino e redação por nome de campo                         | aceito |
| [0007](./0007-autenticacao-por-jwt-do-supabase.md)    | Autenticação por JWT do Supabase: guard global, HS256 e segredo compartilhado   | aceito |
| [0008](./0008-contratos-em-zod-e-clientes-gerados.md) | Contratos em Zod, OpenAPI gerado pela API e um cliente por plataforma           | aceito |
| [0009](./0009-eventos-internos-e-fila-de-jobs.md)     | Eventos internos em memória e fila de jobs com pg-boss                          | aceito |
