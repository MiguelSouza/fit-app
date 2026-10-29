# 0014. Modelo de identidade: `profile` com id próprio, `professional` e organização solo

- **Status:** aceito
- **Data:** 2026-10-27

## Contexto

O card I-01 é o primeiro a escrever tabela neste repositório. Até aqui o
`identity` respondia um `GET /v1/me` provisório, com o UUID nulo como
`personId`, e `apps/api/drizzle/` não tinha migração nenhuma — o card F-07
ligou o Drizzle Kit e parou antes dos `pgTable`, porque o SQL de referência que
ele mandava usar não está no repositório.

Três perguntas ficaram em aberto, e as três valem para todos os módulos que
vêm depois, porque todos vão apontar para a pessoa:

1. **Qual é o id de uma pessoa?** O login é do Supabase Auth (ADR
   [0002](./0002-supabase-como-infraestrutura.md)), que já emite um `uuid` por
   usuário, no `sub` do token. Usar aquele id como chave primária do domínio é
   o caminho mais curto, e é o que a maioria dos exemplos de Supabase faz.
2. **Onde entra a organização?** O `CLAUDE.md` diz que `identity` responde por
   "pessoas, organizações, vínculos", e o produto é para nutricionista
   esportivo, em geral sozinho no consultório. Dá para começar sem organização
   e acrescentá-la quando aparecer a primeira clínica.
3. **O que o cadastro cria?** O card pede quatro entidades atômicas e
   idempotência: "chamar duas vezes não duplica nada".

## Decisão

**O id da pessoa é nosso.** `identity.profile.id` é um `uuid` gerado pelo
Postgres, e o id do Supabase mora em `profile.auth_user_id`, com índice único.
O login é deles e o domínio é nosso: trocar de provedor de identidade, ou
passar a aceitar dois, não deve reescrever a chave estrangeira de todos os
outros schemas.

**Sem chave estrangeira para `auth.users`.** Aquela tabela é do Supabase, não
está em schema que este módulo é dono (CLAUDE.md regra 2), e banco de teste não
tem Auth dentro. O que mantém as duas pontas em pé é o caso de uso, que só
escreve o `sub` de um token verificado.

**Toda pessoa profissional tem organização, desde o primeiro dia.** O cadastro
cria uma `organization` do tipo `solo`, com o nome do profissional, e um
`organization_member` com papel `owner`. Acrescentar organização depois seria
uma migração de dado em cima de todo plano, alerta e vínculo já criado; criar
desde já custa duas linhas por cadastro.

**O enum existe para o segundo valor.** `professional_type` aceita
`nutritionist` (padrão) e `trainer`; `organization_kind` aceita `solo` e
`clinic`. O MVP só cria `nutritionist` e `solo`, mas a regra do `CLAUDE.md` —
"só nutricionista edita plano alimentar, checar `professional_type`, não o papel
genérico" — só quer dizer algo se houver outro tipo possível.

**Idempotência pelo banco, não pela checagem.** O `POST
/v1/professionals/me` lê antes de escrever, e a escrita é um `insert ... on
conflict do nothing` sobre o índice único de `auth_user_id`, dentro de uma
transação. A leitura resolve o caminho normal; o índice resolve a corrida que a
leitura não vê. Chamar de novo responde o cadastro existente e **não**
sobrescreve: editar é outro caso de uso.

**O domínio declara o próprio vocabulário.** `PersonRole`,
`ProfessionalType`, `OrganizationKind` e `OrganizationRole` são tipos de
`modules/identity/domain/`, não importados de `@fit-app/contracts`. O contrato é
a borda da API e o domínio é onde as regras são escritas; as duas listas não
divergem em silêncio porque o controller converte contrato → domínio, o
presenter converte domínio → contrato, e o arquivo do schema Drizzle compara os
valores da coluna com os do contrato por tipo. Qualquer valor que exista de um
lado só quebra a compilação.

Ficou **explicitamente de fora**: vínculo profissional–paciente, convite,
consentimento, registro de acesso e o serviço de acesso que o resto da API vai
usar. Todos são do `identity` e todos têm card próprio. Enquanto não existirem,
nenhum caso de uso deste módulo lê dado de paciente — e é por isso que o
cadastro e o `GET /v1/me` não têm checagem de vínculo nem de consentimento: o
sujeito dos dois é quem está chamando.

## Consequências

- Todo módulo que precisar apontar para uma pessoa aponta para
  `identity.profile.id`, e nunca para o id do Supabase. Quem tiver o `sub` de um
  token e precisar da pessoa pergunta ao `identity`.
- Uma pessoa tem um papel só. Profissional que também é paciente da plataforma
  não cabe neste modelo, e o `POST /v1/professionals/me` responde 409 nesse
  caso. Se o produto quiser os dois papéis, é ADR novo.
- `GET /v1/me` passa a poder responder **404** (`identity.profile.not_found`),
  que é um estado normal e não uma falha: é assim que o painel sabe abrir a tela
  de primeiro acesso.
- O nome do consultório nasce igual ao nome do profissional. Renomear é editar a
  organização, não cadastrar de novo — e a tela disso é de outro card.
- `pnpm db:generate` não depende de `@fit-app/contracts` compilado, porque os
  valores dos enums estão escritos no arquivo do schema. O preço é a conferência
  por tipo, que precisa ser mantida quando um enum ganhar valor.
- A primeira migração existe, então o harness de integração passa a aplicar SQL
  de verdade a cada rodada. Teste de caso de uso crítico agora tem onde rodar
  (`CLAUDE.md`, "Testes").
