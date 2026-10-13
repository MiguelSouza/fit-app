# 0008. Contratos em Zod, OpenAPI gerado pela API e um cliente por plataforma

- **Status:** aceito
- **Data:** 2026-10-13

## Contexto

O `CLAUDE.md` (regra 7, "Contratos primeiro") já decide o rumo: todo DTO nasce
como schema Zod em `packages/contracts` e o OpenAPI é gerado pelo NestJS. Faltava
decidir **com o que**, e isso envolve três escolhas que ficam difíceis de desfazer
depois: como o schema chega ao NestJS, de onde sai o documento e como cada
plataforma vira cliente.

Três consumidores leem o mesmo contrato: a API (TypeScript, CommonJS, compilado
pelo `@nestjs/cli`), o painel (Next.js) e o app do paciente (Flutter/Dart). Dois
deles não são TypeScript nem são pacotes pnpm — o app é construído pelo toolchain
do Dart e está fora do workspace.

O que empurrou a decisão agora: o NestJS 12 e o `@nestjs/swagger` 12 passaram a
ler **Standard Schema** direto (`StandardSchemaValidationPipe`,
`StandardSchemaSerializerInterceptor`, `standardSchema` nos decoradores de
resposta), e o Zod 4 implementa essa interface, inclusive a conversão para JSON
Schema. O que antes exigia uma biblioteca de cola passou a ser nativo.

## Decisão

**Os schemas.** `packages/contracts` é a fonte da verdade: um Zod schema por DTO,
com `id` (que nomeia o componente do OpenAPI), `description` e `example` em
pt-BR, e o tipo sempre inferido com `z.infer`. O pacote é emitido como CommonJS,
porque é assim que a API o carrega, e não importa NestJS, banco nem nada com I/O.

**A ligação com o NestJS.** Usamos o que o framework já traz. Um schema declarado
em `@Body({ schema })` é validado pelo `StandardSchemaValidationPipe` global; um
schema declarado com o nosso decorador `SchemaResponse` documenta a rota **e**
valida a resposta pelo `StandardSchemaSerializerInterceptor`. Dois ajustes nossos:
o que o schema recusa vira `InvalidInputError`, para o erro sair no envelope de
sempre (`{ error: { code, message } }`) com o **nome** dos campos e nenhum valor;
e resposta que não casa com o schema é 500, não um corpo fora do contrato.

Fica **explicitamente de fora** o `nestjs-zod`, que o card F-09 sugeria: hoje ele
só reempacotaria o que o NestJS 12 faz nativamente, e traria a exceção dele —
outro formato de corpo de erro — para dentro de um envelope que já está definido.
A versão atual dele também não declara suporte ao NestJS 12.

**O documento.** `pnpm --filter api openapi:write` lê o app já montado e escreve
`apps/api/openapi.json`, que é **versionado**. É ele que os geradores consomem:
assim o painel e o app compilam sem subir a API, e mudança de contrato aparece
como diff revisável no PR. O `/docs` interativo existe fora de produção; em
produção, não — é o mapa inteiro da API em uma página.

**Os clientes.** `pnpm api:generate` gera os dois, do mesmo documento:

- TypeScript, em `packages/api-client`: `openapi-typescript` gera os tipos e uma
  casca de três linhas sobre `openapi-fetch` dá o cliente. O resultado é
  versionado. Um arquivo `contract.ts` fixa no tipo os campos que os clientes já
  leem, para que remover um campo quebre o `pnpm typecheck` aqui.
- Dart, em `apps/mobile/packages/api_client`: `openapi-generator` com `dart-dio`,
  rodando na **imagem Docker** fixada. A saída **não** é versionada — ela só
  compila depois do `build_runner` do `built_value`, que é trabalho do workspace
  Flutter (card F-14).

## Consequências

Mudar um schema é mudar o contrato, e o repositório passa a cobrar isso: regerar
quebra a compilação de quem lia o campo antigo — na API, nos pins do
`packages/api-client` e, quando existir, no app. É o que queríamos, e tem preço:
toda mudança de DTO pede `pnpm api:generate` e um commit com o `openapi.json`
regerado. Quem esquecer vê o diff aparecer no PR seguinte, confuso.

A validação de resposta custa um `parse` por requisição e dá uma garantia que
nenhuma revisão de código dá: campo que o schema não declara não vai para o
cliente, nem quando alguém devolve uma entidade inteira do banco.

Dependemos de `@nestjs/swagger` na API, de `openapi-typescript` e `openapi-fetch`
no cliente TypeScript, e do **Docker** para o cliente Dart — nenhum JDK na
máquina de ninguém, ao custo de a geração do Dart não rodar sem o engine de pé.

O que faria reverter: o Standard Schema no NestJS é novo. Se o suporte regredir,
a volta é um `ZodValidationPipe` nosso e `z.toJSONSchema()` chamado à mão num
`standardSchemaConverter` — os schemas, o documento versionado e os geradores
continuam de pé, porque nada disso depende de como o NestJS lê o schema.
