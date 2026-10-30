# 0016. Aceite do convite: vínculo da organização, consentimento por finalidade e uma transação

- **Status:** aceito
- **Data:** 2026-10-30

## Contexto

O card I-03 é o outro lado do link do card I-02: o paciente abre o convite, cria
a conta, aceita os termos e dá os consentimentos, e **só então** nasce o vínculo.
Os critérios de aceite dizem três coisas — sem `health_data` e
`share_with_professional` o aceite falha, paciente que já existe só ganha o novo
vínculo, e convite usado não pode ser reutilizado.

Cada uma dessas frases exige uma decisão de modelo que o resto da plataforma vai
herdar, porque é deste vínculo e destes consentimentos que **toda autorização**
desta API vai depender (`CLAUDE.md`, "Saúde e LGPD": profissional só acessa
paciente com vínculo ativo **e** consentimento `share_with_professional`
vigente):

1. **De quem é o vínculo?** Do profissional que convidou ou da organização?
2. **O consentimento é de quê?** Um "aceitei os termos" ou uma resposta por
   finalidade? E de quem — do perfil ou do vínculo?
3. **Quem decide a versão do termo?** O cliente, que mostrou o texto, ou a API?
4. **O que acontece se metade der certo?** Um paciente com vínculo e sem
   consentimento é um paciente que ninguém pode atender; um convite consumido
   sem vínculo é um link perdido para sempre.

## Decisão

**O vínculo é `identity.care_relationship`, e pertence à organização.** As
colunas são `organization_id`, `patient_profile_id`, `invitation_id`,
`started_at` e `ended_at`. É a mesma escolha do convite (ADR
[0015](./0015-convite-por-link-com-token-hasheado.md)) pela mesma razão: a
prática é o que o paciente entra, e numa clínica outro membro tem de poder
assumir o acompanhamento sem o vínculo ser recriado. Quem convidou continua
registrado — em `invited_by_profile_id`, no convite que o `invitation_id` aponta.
Esse ponteiro é também a única trilha que liga um convite ao paciente que o
usou, que é a resposta de "por que este profissional vê este paciente".

**Não existe coluna de situação no vínculo**, como não existe no convite:
`active` e `ended` são lidos de `ended_at` por `domain/care-relationship.ts`, no
instante em que alguém pergunta. Índice único em `(organization_id,
patient_profile_id)`: uma prática acompanha a mesma pessoa uma vez, e dois
cliques não viram dois vínculos. Um acompanhamento que **terminou** e recebe um
convite novo recomeça na mesma linha (`ended_at` volta a nulo, com o novo
convite e a nova data); um que está ativo não é tocado, para a data de início
não andar.

**O consentimento é por finalidade, uma linha por finalidade, e é do perfil.**
`identity.consent` tem `profile_id`, `type`, `terms_version`, `granted_at` e
`revoked_at`. Quatro finalidades: `health_data` e `share_with_professional`, sem
as quais o aceite falha, e `wearable_data` e `ai_processing`, opcionais neste
momento e dáveis depois. "Aceitei os termos" como um único booleano não serve:
LGPD pede consentimento por finalidade, revogável por finalidade, e é disso que
o resto da API vai perguntar ("dados para a IA só com consentimento
`ai_processing` vigente").

Ser **do perfil** e não do vínculo é a parte discutível, e é deliberada: o
paciente consente que a plataforma trate os dados de saúde dele, e
`share_with_professional` é checado **junto** com o vínculo ativo de quem está
perguntando — então quem tem duas práticas e quer cortar uma, encerra o vínculo,
que é o que diz quem acompanha. Um consentimento por prática é um modelo maior
do que este produto tem paciente para justificar, e o dia em que precisar, ele
nasce com `organization_id` nulo para o que já existe.

**Revogar é uma linha nova de estado, nunca um delete.** `revoked_at` é
preenchido, a linha fica, e a história de "deu e tirou" sobrevive — é o que
permite responder, um ano depois, o que era permitido quando. Um consentimento
está **vigente** quando `revoked_at` é nulo, e um índice único **parcial** em
`(profile_id, type) where revoked_at is null` garante que não existam dois
vigentes da mesma finalidade. Dar de novo depois de revogar é uma linha nova.

**A versão do termo é decidida pela API** (`CURRENT_TERMS_VERSION`, em
`domain/consent.ts`) e não vem no corpo da requisição: o que o paciente aceitou
é o texto que **esta** API serviu, e um campo no request deixaria um cliente
registrar concordância com uma versão que ninguém mostrou. Fica explicitamente
de fora: expor a versão vigente num endpoint e recusar aceite de versão antiga —
isso é o card do versionamento dos termos, e `terms_version` já guarda o dado
que ele vai precisar.

**O aceite é uma transação, e o convite é consumido primeiro.** Perfil,
paciente, vínculo, consentimentos e `accepted_at` do convite são uma escrita só,
atrás de uma porta própria (`InvitationAcceptanceRepository`) — e não dois
métodos no repositório de convites, porque o que ela escreve não é um convite. O
`update ... where accepted_at is null and revoked_at is null and expires_at >=
now` vem antes de tudo: se não escreve linha, o link já foi usado, revogado ou
expirou, e a transação termina sem ter escrito nada. É o critério "convite usado
não pode ser reutilizado" decidido pelo banco, não por um valor que o processo
leu um instante antes — e o lock da linha faz o segundo aceite esperar o
primeiro, em vez de correr com ele.

**Todo insert é um upsert numa chave única**: o perfil no `auth_user_id` do
Supabase, o paciente no perfil, o vínculo no par, o consentimento no índice
parcial. É assim que "paciente que já existe só ganha o novo vínculo" vale
quantas vezes a requisição chegar — e nada do perfil é reescrito: o nome e o
fuso que a pessoa preencheu na primeira vez são dela.

**A rota é `POST /v1/invitations/accept`, com o token no corpo.** Não
`/{token}/accept`: o token é credencial portadora, e caminho é o que sobra em
log de acesso, em `Referer` e em breadcrumb do Sentry — o mesmo motivo que o
mantém na query string do link do painel (ADR 0015). A requisição é autenticada
como qualquer outra: quem aceita já entrou no Supabase Auth, e o perfil nasce do
`sub` do token verificado (ADR 0007).

## Consequências

- Toda autorização futura tem o que perguntar: vínculo ativo em
  `care_relationship` e consentimento vigente em `consent`. O serviço de acesso
  do módulo `identity`, que `CLAUDE.md` manda usar em vez de reimplementar,
  nasce dessas duas consultas.
- `identity.patient` existe com quase nada dentro — `profile_id` e
  `created_at`. É o estado honesto: o que um paciente **é** para esta plataforma
  são os check-ins, as medidas e o plano, cada um num módulo com seu card. O que
  a linha já dá é o que join nenhum falsifica, "este perfil é paciente", e é
  nela que as chaves estrangeiras de `nutrition` e `health` vão apontar.
- Uma conta é paciente **ou** profissional, nunca as duas. Profissional que
  abrir um link de paciente recebe 409 (`identity.profile.not_patient`), e a
  checagem está também dentro da transação, onde uma corrida não passa — então
  um link recusado continua usável.
- Falta de consentimento obrigatório responde **422** e não 400: a requisição
  está bem formada e o que recusa é uma regra. É a única rota da API que usa
  esse código hoje, e os clientes precisam tratá-lo.
- A tela que o paciente abre (`/convite?token=...` no painel, e o fluxo
  equivalente no app Flutter) **continua não existindo**: este card entrega a
  API e o módulo `identity`, e a interface é o card de UI que vem depois. O
  formato do link, decidido no ADR 0015, não mudou.
- Sem evento interno no aceite. Nenhum outro módulo reage a um paciente novo
  hoje, e `nutrition.plan.*` e `health.*` são quem vai precisar de um — o
  evento nasce com o primeiro assinante (ADR 0009), não antes.
- Nada do aceite entra em log: nem o token, nem o nome, nem quais finalidades
  alguém consentiu.
