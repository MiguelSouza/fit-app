# CLAUDE.md

Guia para quem escreve código neste repositório, gente ou IA. Leia antes de qualquer mudança.
Quando uma regra daqui atrapalhar, não contorne: proponha a mudança num ADR (`docs/adr/`).

## O produto em uma frase

Plataforma para nutricionistas esportivos que prescrevem a dieta e acompanham o paciente num só lugar,
cruzando alimentação, treino, sono e sintomas para mostrar **quem precisa de atenção e por quê**.
A IA é copiloto do profissional: aponta, nunca diagnostica.

## Stack

| Parte                  | Tecnologia                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| API                    | NestJS (TypeScript strict), monólito modular, clean architecture pragmática                      |
| Painel do profissional | Next.js (App Router), Tailwind, shadcn/ui, TanStack Query e Table, React Hook Form, Recharts     |
| App do paciente        | Flutter (Dart), Riverpod                                                                         |
| Banco                  | Postgres no Supabase (região São Paulo), Drizzle ORM, um schema por módulo                       |
| Login e arquivos       | Supabase Auth (a API valida o JWT) e Supabase Storage                                            |
| Jobs                   | pg-boss                                                                                          |
| Validação e contratos  | Zod compartilhado + OpenAPI gerado pelo NestJS                                                   |
| Infra                  | AWS sa-east-1 (ECS Fargate, ECR, ALB, Secrets Manager, CloudWatch) via AWS CDK; painel na Vercel |
| Monorepo               | Turborepo + pnpm                                                                                 |

## Estrutura do repositório

```
apps/
  api/            NestJS
  web/            Next.js (painel)
  mobile/         Flutter (app do paciente)
packages/
  contracts/      schemas Zod, tipos e enums compartilhados (fonte da verdade dos DTOs)
  api-client/     cliente TypeScript gerado do OpenAPI
  config/         eslint, tsconfig, prettier compartilhados
infra/            AWS CDK
docs/adr/         registros de decisão de arquitetura
scripts/          seeds, gerador de pacientes sintéticos, importação TACO/TBCA
```

## Módulos de domínio (apps/api/src/modules)

| Módulo      | Schema Postgres | Responsável por                                                                |
| ----------- | --------------- | ------------------------------------------------------------------------------ |
| `identity`  | `identity`      | pessoas, organizações, vínculos, convites, consentimentos, registro de acessos |
| `nutrition` | `nutrition`     | alimentos, planos, refeições, opções, cálculo de macros, adesão                |
| `health`    | `health`        | conexões de wearable, atividades, sono, métricas diárias, check-ins, medidas   |
| `insights`  | `insights`      | regras de alerta, alertas, resumos por IA, intervenções, linha do tempo        |

Camadas dentro de cada módulo:

```
modules/<modulo>/
  domain/          entidades, value objects, regras puras. Sem NestJS, sem banco, sem I/O
  application/     casos de uso (um arquivo por caso de uso), portas (interfaces) para fora
  infrastructure/  repositórios Drizzle, adaptadores de fornecedores, jobs
  presentation/    controllers, DTOs (a partir de packages/contracts), guards
  <modulo>.module.ts
  index.ts         API pública do módulo: a ÚNICA coisa que outros módulos importam
```

## Regras de arquitetura (não negociáveis)

1. **Fronteira de módulo.** Um módulo nunca importa arquivos internos de outro; só o `index.ts` dele.
2. **Dono das tabelas.** Cada módulo só lê e escreve no próprio schema. Sem joins entre schemas no código.
   Precisa de dado de outro módulo? Chame o serviço público dele ou reaja a um evento.
3. **Eventos internos** para efeitos colaterais entre módulos (ex.: `nutrition.plan.activated`,
   `health.sleep.received`, `insights.alert.created`). Nome no formato `<modulo>.<entidade>.<fato no passado>`.
4. **Domínio puro.** `domain/` não importa NestJS, Drizzle, Zod de infraestrutura nem nada com I/O.
   Cálculo de macros e regras de alerta vivem aqui, com testes unitários.
5. **Portas para o que pode mudar.** Agregador de wearables, fornecedor de IA, fila, e-mail, push e pagamento
   ficam atrás de uma interface em `application/ports`. O banco não precisa de abstração tabela a tabela.
6. **Clientes só falam com a API.** App e painel não acessam o banco do Supabase diretamente (exceto o login).
7. **Contratos primeiro.** Todo DTO nasce como schema Zod em `packages/contracts`. Mudou a API? Regere o cliente.

## Saúde e LGPD (obrigatório)

- **Autorização em todo caso de uso.** Profissional só acessa paciente com vínculo ativo **e** consentimento
  `share_with_professional` vigente. Use o guard/serviço de acesso do módulo `identity`; nunca reimplemente.
- **Só nutricionista edita plano alimentar.** Checar `professional_type`, não o papel genérico.
- **Registrar acesso** (`identity.logAccess`) ao abrir a ficha de um paciente ou exportar dados.
- **Nunca logar dado de saúde nem dado pessoal** (nome, e-mail, telefone, valores de check-in, notas).
  Logue ids e códigos. Vale para Sentry, CloudWatch e Langfuse (anonimize antes de enviar prompts).
- **Dados para a IA** só com consentimento `ai_processing` vigente.
- **Linguagem de apoio, nunca de diagnóstico** em textos gerados: "merece revisão", nunca "o paciente tem X".
- **Revogar consentimento corta o acesso na hora.** Não guardar cópias em cache que ignorem isso.
- **Strava não é fonte de dados** (termos proíbem exibir ao coach e usar em IA).

## Dados de saúde

- Ao entrar, todo dado de wearable é normalizado: UTC no banco, fuso do paciente guardado no perfil,
  unidades do sistema métrico, e a "noite" de sono identificada pela data em que começou.
- Dados de wearable são gravados só por jobs/webhooks do backend, nunca editados por usuários.
- Valores nutricionais sempre por 100 g; totais são calculados, nunca digitados.

## Convenções

- TypeScript `strict`; proibido `any` sem comentário justificando.
- Código, nomes e commits em inglês; textos de interface em português (pt-BR) e prontos para i18n.
- Commits no padrão Conventional Commits (`feat(nutrition): ...`).
- Erros de domínio são classes próprias, traduzidas para HTTP só na camada `presentation`.
- Datas com `date-fns` / `date-fns-tz`; dinheiro em centavos (inteiro).
- Migrações só via Drizzle Kit, revisadas no PR. Nunca alterar o banco de produção à mão.
- Turborepo muda de comportamento e de configuração entre versões: antes de mexer no `turbo.json` ou
  nos comandos do `turbo`, leia os docs embarcados na versão instalada (`docs/README.md` dentro do
  pacote, achável com `node -p "require.resolve('turbo/package.json')"`), não a documentação do site.

## Testes

- `domain/`: testes unitários obrigatórios (cálculo de macros, regras de alerta).
- `application/`: testes de integração com Postgres real (Testcontainers) para casos de uso críticos.
- Painel: Playwright para os fluxos críticos (montar plano, revisar alerta).
- Use o gerador de pacientes sintéticos (`scripts/`). **Nunca use dados reais de pacientes em dev ou teste.**

## Decisões (ADRs)

Toda decisão que mude estrutura, dependência importante ou regra deste arquivo vira um ADR curto em
`docs/adr/NNNN-titulo.md` (contexto, decisão, consequências). Decisões já tomadas:

- 0001 Monólito modular com NestJS e clean architecture pragmática
- 0002 Supabase como infraestrutura (Postgres, Auth, Storage); regra de negócio na API
- 0003 Wearables via agregador atrás de uma porta própria
- 0004 Um schema Postgres por módulo
- 0005 AWS sa-east-1 com ECS Fargate e CDK; painel na Vercel

## Não faça

- Microsserviços, Kubernetes, Kafka, Redis ou GraphQL sem um ADR aprovado.
- Lógica de negócio em controller, componente React ou widget Flutter.
- Acesso direto ao banco a partir do app ou do painel.
- Dependência nova sem motivo claro no PR.
