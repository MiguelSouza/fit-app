# @fit-app/scripts

Scripts do repositório. Hoje: o gerador de pacientes sintéticos (card **F-15**)
e a geração do cliente Dart. A importação TACO/TBCA entra depois, pelo card dela.

## Como o pacote roda

Os arquivos em `src/` são TypeScript e o Node os executa direto, apagando os
tipos (`type stripping`, estável o suficiente no Node 24, que é o que o
repositório exige). Não há build, não há bundler e não há loader: `pnpm
typecheck` só confere, e `node src/...` roda o mesmo arquivo.

Três configurações sustentam isso, em [`tsconfig.json`](./tsconfig.json):

- `erasableSyntaxOnly` quebra o typecheck em qualquer coisa que o `type
stripping` não saiba apagar (`enum`, `namespace`, parâmetro-propriedade), de
  modo que um arquivo que passa no typecheck é um arquivo que o Node roda;
- `allowImportingTsExtensions`, porque o Node exige a extensão no especificador
  (`./random.ts`);
- `"type": "module"` no `package.json`, sem o qual o Node leria estes arquivos
  como CommonJS e recusaria o primeiro `import`.

Os testes são o runner do próprio Node (`node --test`), como em
`packages/config`. `pnpm --filter @fit-app/scripts test` roda os 54.

## `pnpm seed:synthetic` — pacientes sintéticos

```bash
pnpm seed:synthetic --patients 20    # na raiz do monorepo
pnpm seed:synthetic --help           # as opções e os perfis
```

Gera **uma organização, 1 nutricionista e N pacientes** com 90 dias de
atividades, sono, métricas diárias, check-ins, peso e adesão às refeições.
Nenhum dado real de paciente entra em desenvolvimento ou teste (CLAUDE.md,
"Testes"), e isto é o que se usa no lugar: para testar regras de alerta, para
avaliar o que a IA escreve sobre uma ficha, e para demonstrar o produto sem o
corpo de ninguém dentro.

| Opção            | Padrão               | O que faz                          |
| ---------------- | -------------------- | ---------------------------------- |
| `-p, --patients` | `10`                 | quantos pacientes (1 a 400)        |
| `-s, --seed`     | `20260115`           | a semente aleatória                |
| `-d, --days`     | `90`                 | tamanho da janela (21 a 730)       |
| `--end-date`     | hoje, em UTC         | último dia da janela, `YYYY-MM-DD` |
| `-o, --out`      | `scripts/.synthetic` | onde escrever                      |

### Os seis perfis

Os seis primeiros pacientes recebem um perfil cada, nesta ordem; depois disso o
baralho repete com `estavel` em metade das cadeiras — uma fila em que todo mundo
precisa de atenção é uma fila que ninguém tem o que triar.

| Perfil                        | O que se vê nos dados                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `estavel`                     | nada se move: sono, treino, peso e adesão ficam na faixa de sempre                    |
| `sobrecarga`                  | treino sobe ~90%, sono cai ~1h40, FC de repouso sobe e a VFC desaba                   |
| `perda-de-peso-nao-planejada` | peso cai ~7,5% com treino e adesão normais; a energia ingerida e o apetite caem       |
| `adesao-em-queda`             | adesão às refeições cai de ~96% para ~32%, peso sobe devagar                          |
| `sumiu`                       | check-in, peso e registro de refeição param no dia 31; o wearable continua reportando |
| `energia-baixa`               | energia no check-in ≤ 2, VFC baixa e passos em queda, com sono de duração normal      |

O `sumiu` é o único em que as três séries do paciente param e as duas do
aparelho seguem: um corpo que continua sendo medido ao lado de uma pessoa que
parou de responder é a assinatura inteira do perfil.

### Reprodutibilidade

A mesma semente e a mesma janela produzem exatamente os mesmos bytes. O
gerador não lê relógio, variável de ambiente nem disco: as opções são toda a
entrada dele, e o `manifest.json` da saída guarda as que foram usadas — o
comando imprime, no fim, a linha que repete a rodada.

Duas propriedades que valem conhecer:

- **`--patients 20` contém as mesmas pessoas que `--patients 5`**, mais quinze.
  Cada paciente sorteia de um fluxo derivado do índice dele, não de um fluxo
  compartilhado, então rodar com 5 é um jeito rápido de olhar as mesmas pessoas.
- **`--end-date` é o único eixo que segue o calendário.** O padrão é hoje, em
  UTC, porque esses dados existem para testar alertas e alertas olham "os
  últimos N dias". Os valores vêm só da semente; a janela, da data. Para fixar
  as duas coisas, passe `--end-date`.

### O que a saída tem

Em `scripts/.synthetic/` (ignorada pelo git):

| Arquivo                 | O que é                                                  |
| ----------------------- | -------------------------------------------------------- |
| `manifest.json`         | semente, janela, fuso e o perfil de cada paciente        |
| `organization.json`     | a clínica e a nutricionista                              |
| `patients.json`         | a lista de pacientes sem as séries: o arquivo para abrir |
| `patients/PAC-00N.json` | um paciente inteiro, com os 90 dias                      |
| `summary.json`          | a tabela que o comando imprime                           |

O comando só esvazia uma pasta `--out` que ele próprio escreveu (reconhecida
pelo marcador no `manifest.json`). Uma rodada precisa substituir a anterior, e
não se somar a ela, mas o caminho é digitado por uma pessoa.

### Nada aqui se parece com uma pessoa real

É o terceiro critério do card, e a garantia é estrutural, não estatística:

- **os nomes são palavras inventadas**, escritas à mão em
  [`src/synthetic/names.ts`](./src/synthetic/names.ts). Não saem de lista de
  censo, não são "nomes brasileiros comuns" e não são um cadastro real
  anonimizado. `Varnesca Quilopeda` se lê como pessoa e não corresponde a
  ninguém — e qualquer um que veja esses dados numa demo percebe de imediato
  que não há paciente atrás deles;
- **os e-mails não chegam a ninguém**: o domínio é `exemplo.invalid`, e
  `.invalid` é reservado pela RFC 2606 — não pode ser registrado e não resolve;
- **não há documento nem telefone**. Nenhum CPF, nenhum CRN, nenhum número que
  possa coincidir com um de verdade. O card não pede, e um identificador gerado
  que por acaso valide é um problema, não um recurso.

Organização, nutricionista e pacientes saem marcados com `synthetic: true`: uma
linha que chegue a um banco por acidente deve ser reconhecível lá, não só no
arquivo de onde veio.

### O que ainda não fecha: escrever no Postgres

O gerador escreve **json**, e não linhas no banco. Os quatro schemas de módulo
não existem: o card **F-07** ligou o Drizzle Kit e parou aí, `apps/api/drizzle/`
não tem nenhuma migração e `apps/api/src/modules/*/infrastructure/` não tem
nenhum arquivo `*.schema.ts`. Não há tabela em que inserir.

O que falta é um passo de escrita, não um redesenho. As séries em
[`src/synthetic/records.ts`](./src/synthetic/records.ts) já usam o vocabulário
que o CLAUDE.md fixa para `health` e `nutrition` (instante em UTC, data local
do paciente, unidades métricas, noite de sono identificada pela data em que
começou, totais calculados a partir das refeições), então o dia em que as
tabelas entrarem o trabalho é mapear campo a campo e abrir uma transação por
paciente. Quando isso acontecer, o comando ganha um `--to-database` e esta
seção vira a documentação dele.

Até então: as fábricas dos testes de integração (`apps/api/src/shared/testing/`)
esperam as mesmas tabelas, e este gerador é a fonte dos dados que elas vão usar.

### Por que o comando imprime números de saúde

A tabela no fim da rodada mostra variação de peso, de sono e de adesão — o tipo
de valor que a regra de log do CLAUDE.md proíbe. Vale aqui por um motivo só:
não existe pessoa atrás de nenhum desses números. Este script não toca o logger
da API, não manda nada para CloudWatch, Sentry ou Langfuse, e o que ele imprime
não sai do terminal. É justamente essa tabela que responde ao critério "cada
perfil problemático é identificável a olho nos dados": os detectores de
[`src/synthetic/summary.ts`](./src/synthetic/summary.ts) são as frases que o
`profiles.test.ts` verifica, nos mesmos números.

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
`built_value`, e isso é trabalho do workspace Flutter (card **F-14**), que
depende dela com `path: packages/api_client`.

O app não está no `pnpm-workspace.yaml` — é Flutter, construído pelo toolchain
do Dart. Este script é só o que escreve a pasta.
