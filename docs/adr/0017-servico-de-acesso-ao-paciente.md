# 0017. Serviço de acesso ao paciente: uma regra, negativa em 404 e um decorator

- **Status:** aceito
- **Data:** 2026-11-09

## Contexto

O card I-04 escreve a regra mais importante do produto: profissional só acessa
dados de um paciente com **vínculo ativo** e consentimento
`share_with_professional` **vigente** (`CLAUDE.md`, "Saúde e LGPD"). As tabelas
já existem — `care_relationship` e `consent`, do card I-03 (ADR
[0016](./0016-aceite-do-convite-vinculo-e-consentimento.md)) — e o que falta é
quem responde a pergunta, para que `nutrition`, `health` e `insights` não
respondam cada um por si.

O `CLAUDE.md` é explícito em "use o guard/serviço de acesso do módulo
`identity`; nunca reimplemente", e a razão é prática: a segunda cópia da
checagem é a que esquece metade dela, e o que ela esquece é um furo de LGPD que
nenhum teste de outro módulo vai procurar.

Quatro decisões não são óbvias:

1. **Onde a regra mora?** Numa função pura, num serviço, ou num guard?
2. **A pergunta é por profissional e o vínculo é da organização.** Quem faz essa
   tradução?
3. **Que status uma negativa devolve?** 403 é o que o `permission_denied` do
   `domain-error.ts` diz, e o card pede 404.
4. **Como um controller de outro módulo usa isso** sem furar a fronteira de
   módulo (regra 1)?

## Decisão

**A decisão é uma função pura em `domain/patient-access.ts`.**
`decidePatientAccess(facts)` e `decideMealPlanEdit(facts)` recebem os fatos —
tipo do profissional, os vínculos dele com aquele paciente, e se o
consentimento está vigente — e devolvem concedido, ou negado com um **código de
motivo** (`no_care_relationship`, `care_relationship_ended`,
`consent_not_in_force`, `not_a_professional`, `not_a_nutritionist`). Uma regra
que ninguém reimplementa é uma regra que é função, com teste unitário
(`CLAUDE.md` regra 4), não quatro linhas copiadas em cada caso de uso.

**O serviço público é `PatientAccessService`, em `application/`, e sai pelo
`index.ts`.** Quatro métodos, dois formatos da mesma pergunta:
`canAccessPatient` e `canEditMealPlan` para código que decide algo (esconder um
botão, filtrar uma lista), `assertCanAccessPatient` e `assertCanEditMealPlan`
para a primeira linha de um caso de uso. O `assert` do plano alimentar entra
junto de propósito: sem ele, cada módulo traduziria o booleano para HTTP por
conta própria, que é exatamente o que este card existe para evitar.

**Os fatos vêm de uma porta com um método só**
(`PatientAccessRepository.findFacts`), e **nada é cacheado**. Um método por
condição é como um chamador acaba checando uma das duas; e cache com validade é
a cópia que ignora "revogar consentimento corta o acesso na hora". O preço são
duas consultas por requisição que toca paciente, disparadas juntas porque não
dependem uma da outra: a do profissional com os vínculos das práticas dele
(`join` em `organization_member`, que é o que faz o vínculo ser da organização e
não de quem convidou) e a do consentimento vigente, que é uma sonda no índice
parcial.

**Negativa de acesso é 404, com `identity.patient.not_found`.** É o único lugar
desta base onde o status é decisão de segurança e não descrição: 403 seria um
oráculo — o profissional tentando ids receberia "não pode" para os que existem e
"não existe" para o resto, e essa diferença é a lista de pacientes da
plataforma, uma requisição por vez. Paciente que o chamador não pode ver e
paciente que não existe respondem a mesma coisa, inclusive para id que não é
uuid, e o motivo fica no log.

**Plano alimentar sem ser nutricionista é 403**
(`identity.meal_plan.nutritionist_required`). Quem recebe esse erro **já tem
acesso** ao paciente, então não há o que esconder: está sendo informado do que o
registro dele não cobre. Sem acesso, recebe o 404 e nunca chega aqui. A checagem
é de `professional_type`, não do papel genérico (`CLAUDE.md`).

**A rota HTTP fecha com `@RequiresPatientAccess()`**, um decorator só, que grava
o nome do parâmetro e põe o guard na rota — rota que declarasse um sem o outro
pareceria protegida sem estar. O guard é **por rota e não global**, ao contrário
do `SupabaseJwtGuard` (ADR
[0007](./0007-autenticacao-por-jwt-do-supabase.md)): autenticação é o padrão
certo para toda rota desta API e acesso a paciente não é, porque a maioria das
rotas não tem paciente; e guard de controller roda **depois** do global, então o
token já foi verificado quando ele pergunta. O guard não é substituto da
checagem no caso de uso — job, handler de evento e caso de uso chamado por outro
não têm `ExecutionContext`, e esses chamam `assertCanAccessPatient` na mão.

**O que o `identity.module.ts` exporta é o serviço, o guard e o
`LoadProfessionalCaller`.** O terceiro é exigência do Nest, não nossa: guard
nomeado em `@UseGuards(Classe)` é instanciado no módulo do **controller** que o
usa, então as dependências dele têm de ser alcançáveis de lá. A porta
(`PATIENT_ACCESS_REPOSITORY`) continua privada, o `index.ts` só nomeia o serviço
e o decorator, e o lint impede outro módulo de importar os arquivos (regra 1).

**Recusa vira uma linha de log com os dois ids e o código do motivo**, em
`warn`, e nada mais: nome nenhum, prática nenhuma (`CLAUDE.md` — ids e códigos).
É o que permite distinguir, no CloudWatch, "este paciente é de outra clínica" de
"o paciente revogou o consentimento", que são o mesmo 404 e conversas bem
diferentes.

## Consequências

- `nutrition`, `health` e `insights` passam a ter uma linha para escrever:
  `imports: [IdentityModule]` e `@RequiresPatientAccess()` na rota, ou o
  `assertCanAccessPatient` no caso de uso. Nenhum deles toca
  `care_relationship` ou `consent`.
- Nenhuma rota nova entra nesta entrega: `nutrition`, `health` e `insights`
  ainda são esqueletos, e o endpoint que o guard protege vive no teste
  (`patient-access.guard.spec.ts`), sobre o `IdentityModule` real. O OpenAPI não
  muda, e o cliente gerado não precisa ser regerado.
- O painel não consegue distinguir "não existe" de "não pode" — de propósito. A
  mensagem é uma só ("Paciente não encontrado."), e a tela que trata disso manda
  o profissional para a lista dele.
- **O registro de acesso (`identity.logAccess`) não entra aqui.** Abrir a ficha
  de um paciente tem de ser registrado (`CLAUDE.md`), mas isso é a tabela de
  acessos, com card próprio: checagem de autorização também roda em requisições
  que não são "abrir a ficha", e conflatar as duas gera um registro que mente. O
  guard, que já sabe profissional, paciente e rota, é onde ele vai entrar.
- Personal trainer que vê o paciente e não prescreve é um caso de **clínica**:
  hoje o cadastro só cria nutricionista em consultório solo (ADR
  [0014](./0014-modelo-de-identidade-e-organizacao-solo.md)), então o cenário
  aparece quando houver convite de membro para a organização. A regra já está
  escrita e testada, inclusive contra Postgres real.
- Não existe consentimento por profissional: revogar `share_with_professional`
  corta todas as práticas. É herança consciente do ADR 0016 — para cortar uma só,
  o que termina é o vínculo.
- Fica de fora o cache. Se as duas consultas por requisição virarem problema,
  o lugar de resolver é o `PatientAccessRepository`, com invalidação na
  revogação do consentimento e no fim do vínculo — e isso é um ADR novo, não um
  ajuste silencioso.
