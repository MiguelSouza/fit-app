# @fit-app/observability

O que a plataforma **não** manda para fora sobre uma pessoa, em um lugar só
(`CLAUDE.md`, "Saúde e LGPD": logue id e código, nunca nome, e-mail, telefone,
nota ou valor de check-in — vale para CloudWatch, Sentry e Langfuse).

```
src/
  sensitive-fields.ts   a lista de nomes de campo sensíveis, e a máscara
  scrub-event.ts        o `beforeSend` dos SDKs do Sentry
  index.ts              API pública do pacote: é o que os outros importam
```

Duas metades da mesma regra:

- **`sensitive-fields.ts`** é lido pelo logger da API, que mascara todo objeto
  de log antes de o pino serializar ([ADR
  0006](../../docs/adr/0006-logger-estruturado-com-pino.md)).
- **`scrub-event.ts`** é o `beforeSend` do Sentry da API e do painel ([ADR
  0013](../../docs/adr/0013-sentry-nos-tres-apps.md)).

Uma lista só, porque campo que é dado pessoal em linha de log é dado pessoal em
relatório de erro. O app do paciente não consegue importar TypeScript e carrega
as mesmas regras em Dart, em `apps/mobile/lib/src/core/observability/`.

O pacote não tem dependência nenhuma e não faz I/O: é lido pela API, pelo
Next.js (inclusive no navegador) e por quem mais precisar decidir se um campo
pode sair. O tipo do evento é declarado estruturalmente (`ScrubbableEvent`), e
não importado do `@sentry/core`, para o mesmo filtro servir ao `@sentry/node`
da API e ao `@sentry/nextjs` do painel; quem chama é checado pelo compilador,
então um campo que mude de forma numa versão futura quebra o build em vez de
vazar.

## O que o filtro faz com um evento

| Parte do evento             | O que sai                                                     |
| --------------------------- | ------------------------------------------------------------- |
| `user`                      | só o `id`; sem id, o usuário todo sai                         |
| `request`                   | método e caminho; sem corpo, cookie, header ou query          |
| `message`, `exception`      | o tipo fica, o texto vira `[redacted]`                        |
| quadros da pilha            | arquivo, linha e código-fonte ficam; variáveis locais não     |
| `breadcrumbs`               | categoria, status e endereço; texto e dados fora da lista não |
| `extra`, `contexts`, `tags` | máscara por nome de campo, a mesma do log                     |

Texto livre é mascarado porque quem escreveu a mensagem pode ser o driver do
banco, e mensagem de Postgres cita o valor que quebrou a query (`Key
(email)=(...) already exists`) — o mesmo motivo de `safe-error.ts` na API. Tipo,
pilha e código dizem onde quebrou, que é o que depurar precisa.

## Scripts

| Script                                           | O que faz                           |
| ------------------------------------------------ | ----------------------------------- |
| `pnpm --filter @fit-app/observability build`     | `tsc`: emite `dist/` com os `.d.ts` |
| `pnpm --filter @fit-app/observability typecheck` | `tsc --noEmit`                      |
| `pnpm --filter @fit-app/observability lint`      | eslint                              |

Não há teste aqui: o pacote não tem dependência para levantar um teste em cima,
e o que ele decide é afirmado onde é usado — em
`apps/api/src/shared/observability/`, contra o SDK real do Sentry (o teste
inspeciona o envelope que o transporte receberia), e em
`apps/api/src/shared/logging/`, contra o logger real.

O pacote é emitido como **CommonJS**, que é como o `@nestjs/cli` compila a API e
como ela o carrega.
