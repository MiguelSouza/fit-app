# 0005. AWS sa-east-1 com ECS Fargate e CDK; painel na Vercel

- **Status:** aceito
- **Data:** 2026-10-08

## Contexto

A API conversa com o Postgres do Supabase a cada requisição, e esse banco está em
São Paulo ([0002](./0002-supabase-como-infraestrutura.md)). Hospedar a API longe
dele somaria latência de ida e volta em toda chamada. O painel em Next.js tem
necessidade oposta: é estático e de borda na maior parte, e ganha pouco em ficar
colado no banco.

A equipe é pequena, então a infraestrutura tem que caber em código versionado e
não exigir operação diária.

## Decisão

A API roda na AWS em `sa-east-1`, em ECS Fargate, com imagem no ECR, Application
Load Balancer com HTTPS via ACM, segredos no Secrets Manager e logs no
CloudWatch. Tudo descrito em AWS CDK (TypeScript), em `infra/`.

O painel Next.js fica na Vercel.

Há dois ambientes, staging e produção, cada um com o seu projeto Supabase. As
migrações rodam antes do deploy. Nenhum segredo fica fora do Secrets Manager.

## Consequências

A API fica na mesma região do banco, e a latência extra por chamada deixa de ser
um problema de arquitetura.

O preço é operar duas plataformas de deploy, com dois modelos de permissão e dois
lugares para investigar um incidente. Aceitamos isso porque a alternativa —
painel também no ECS — trocaria esse custo por construir à mão o que a Vercel já
dá para Next.js.

Infra em CDK significa que criar um ambiente novo é `cdk deploy`, e que mudança
de infraestrutura passa por revisão de PR como qualquer código. Em troca, exige
saber CDK para mexer em produção.

Fargate custa mais por unidade de CPU do que EC2 reservada. Na escala do beta a
diferença é pequena frente ao tempo que não gastamos administrando instância.
