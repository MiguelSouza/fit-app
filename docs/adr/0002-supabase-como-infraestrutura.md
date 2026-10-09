# 0002. Supabase como infraestrutura (Postgres, Auth, Storage); regra de negócio na API

- **Status:** aceito
- **Data:** 2026-10-08

## Contexto

Lidamos com dado de saúde de pacientes brasileiros, sob LGPD, e a equipe é
pequena demais para operar Postgres, um provedor de identidade e um serviço de
arquivos por conta própria. Precisamos também que o dado fique no Brasil e perto
da API, para latência e para simplificar a conversa sobre transferência
internacional de dados.

## Decisão

Usamos Supabase na região de São Paulo para três coisas: Postgres (com Drizzle
ORM), Auth e Storage.

A regra de negócio vive inteira na API. A API valida o JWT emitido pelo Supabase
Auth e decide tudo a partir daí: vínculo ativo, consentimento vigente, tipo de
profissional, registro de acesso.

O painel e o app **não acessam o banco do Supabase diretamente** — falam só com a
API. A única exceção é o próprio login, que fala com o Supabase Auth.

## Consequências

Ganhamos Postgres gerenciado, identidade e arquivos sem time de infraestrutura,
e o dado fica em São Paulo, perto do ECS em `sa-east-1` (ver [0005](./0005-aws-sa-east-1-e-vercel.md)).

A consequência que mais importa: **RLS não é a nossa linha principal de defesa.**
Como os clientes não falam com o banco, a autorização é responsabilidade de cada
caso de uso, usando o serviço de acesso do módulo `identity`. Se algum dia um
cliente passar a consultar o banco direto, essa premissa cai e este ADR precisa
ser revisto.

Há lock-in moderado: trocar o Auth significa migrar identidades e emissão de
token. Postgres e Storage são mais portáveis. O risco é aceitável porque a regra
de negócio, que é o ativo caro, não está no Supabase.

Um segundo projeto Supabase por ambiente (staging e produção) passa a ser
requisito, para nunca misturar dado de teste com dado real.
