# @fit-app/scripts

Scripts do repositório: seeds, gerador de pacientes sintéticos e importação
TACO/TBCA entram pelo card **F-15**. O que já existe aqui é a geração do
cliente Dart.

## `generate-dart-client.mjs`

Gera o cliente Dart da API, para o app Flutter, a partir de
[`apps/api/openapi.json`](../apps/api/openapi.json) — o mesmo documento de que
sai o cliente TypeScript. Um contrato, duas plataformas.

```bash
pnpm api:generate                                  # na raiz: documento + os dois clientes
pnpm --filter @fit-app/scripts generate:dart-client # só o cliente Dart
```

O gerador roda **em Docker**, na imagem `openapitools/openapi-generator-cli`
fixada no script: o `openapi-generator` é um programa Java, e pedir um JDK da
versão certa em toda máquina é pior do que pedir o Docker, que o repositório já
exige para o Supabase local.

A saída é um pacote Dart em `apps/mobile/packages/api_client`, com `dio` e
`built_value` (`dart-dio`), e **não é versionada**: ela só vira código utilizável
depois de `dart run build_runner build` escrever os arquivos `.g.dart` do
`built_value`, e isso é trabalho do workspace Flutter (card **F-14**), que vai
depender dela com `path: packages/api_client`.

O app não está no `pnpm-workspace.yaml` — é Flutter, construído pelo toolchain
do Dart. Este script é só o que escreve a pasta.
