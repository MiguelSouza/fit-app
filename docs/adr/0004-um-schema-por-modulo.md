# 0004. Um schema Postgres por módulo

- **Status:** aceito
- **Data:** 2026-10-08

## Contexto

O [0001](./0001-monolito-modular-com-nestjs.md) define fronteiras entre módulos
no código, mas um banco com todas as tabelas em `public` não oferece resistência
nenhuma: o primeiro join entre domínios acopla os módulos permanentemente e o
acoplamento só aparece quando já é caro desfazer.

## Decisão

Cada módulo tem o seu schema no Postgres: `identity`, `nutrition`, `health` e
`insights`.

Cada módulo só lê e escreve no próprio schema. **Não há join entre schemas no
código.** Quando um módulo precisa de dado de outro, chama o serviço público dele
(o `index.ts`) ou reage a um evento interno.

As migrações saem só do Drizzle Kit e são revisadas no PR. O banco de produção
nunca é alterado à mão.

## Consequências

A fronteira passa a ser visível na camada que mais resiste a boas intenções: um
join indevido não é feio, é um erro de permissão de schema.

O custo aparece nas consultas que o produto realmente faz. A carteira de
pacientes do painel mistura identidade, adesão nutricional e dados de saúde, e
agora isso é composição na camada de aplicação, não um `SELECT` com joins. Em
algum ponto de volume isso vira gargalo; a saída prevista é o módulo `insights`
manter a sua própria projeção de leitura, alimentada por eventos, e não relaxar
esta regra.

Relatório e análise que cruzam domínios não podem ser feitos com SQL ad hoc
sobre schemas alheios. Se a necessidade surgir, cabe um ADR novo sobre leitura
analítica.
