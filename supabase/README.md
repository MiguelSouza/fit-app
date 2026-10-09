# supabase/

Ambiente local do fit-app: Postgres, Auth e Storage em Docker, pelo Supabase CLI.
O passo a passo do zero está no [README da raiz](../README.md#do-zero-ao-banco-rodando).

```
supabase/
  config.toml    o que está ligado, em que porta, com que ajuste
  seed.sql       dados carregados no fim do `pnpm db:reset`
```

## O que está ligado, e o que não está

O `config.toml` é enxuto de propósito: o `supabase init` escreve todos os padrões
como comentário, e aqui ficou só o que foi decidido. O resto segue o padrão do
CLI, então atualizar o CLI não congela um padrão velho no repositório.

| Serviço              | Estado      | Por quê                                                           |
| -------------------- | ----------- | ----------------------------------------------------------------- |
| Postgres             | ligado      | o banco                                                           |
| Auth                 | ligado      | emite o JWT que a API valida (ADR 0002)                           |
| Storage              | ligado      | anexos do paciente                                                |
| Studio               | ligado      | olhar o banco pelo navegador                                      |
| Caixa de e-mail      | ligado      | ler o que o Auth manda, sem sair da máquina                       |
| Data API (PostgREST) | só `public` | cliente não fala com o banco; os schemas de domínio ficam fora    |
| Realtime             | desligado   | ninguém assina o banco                                            |
| Edge Functions       | desligado   | regra de negócio é da API NestJS                                  |
| Analytics (Logflare) | desligado   | contêiner pesado sem uso local; em produção o log é do CloudWatch |

A Data API expõe só o schema `public`. Os schemas de domínio (`identity`,
`nutrition`, `health`, `insights`) não são alcançáveis de fora da API — é a regra
6 do [`CLAUDE.md`](../CLAUDE.md) escrita na configuração, não só na prosa.

## Migrações

Ainda não existe `migrations/`: não há schema. A pasta nasce com a primeira
migração, que é gerada pelo **Drizzle Kit** e revisada no PR — nunca escrita à
mão no banco, nunca aplicada à mão em produção. A partir daí o `pnpm db:reset`
recria o banco local, replica todas as migrações em ordem e termina no
`seed.sql`.

## Seed

`seed.sql` só recebe **dado sintético**. Dado de saúde é dado pessoal sensível
sob a LGPD: dado real de paciente não entra em desenvolvimento nem em teste. O
gerador de pacientes sintéticos vive em [`scripts/`](../scripts/README.md).

## Local não é produção

Este diretório descreve **apenas a máquina de quem desenvolve**. Produção e
staging são dois projetos Supabase hospedados, na região de **São Paulo**, ao
lado da API na AWS **`sa-east-1`**
([ADR 0002](../docs/adr/0002-supabase-como-infraestrutura.md),
[ADR 0005](../docs/adr/0005-aws-sa-east-1-e-vercel.md)).

Nada aqui aponta para eles: não há `project_ref` vinculado, e `supabase link`,
`db push` e `db pull` não fazem parte do fluxo de ninguém — quem publica
migração é o deploy. As chaves impressas pelo `db:start` são locais, geradas de
um segredo público do CLI, e não abrem nada fora do seu Docker.

## Chaves e segredos

O `config.toml` é commitado, então ele não pode conter segredo. Quando algum
ajuste precisar de um valor sensível, use a substituição por ambiente do próprio
CLI — `campo = "env(NOME_DA_VARIAVEL)"` — e declare a variável no
[`.env.example`](../.env.example), sempre vazia.
