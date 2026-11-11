# 0020. Encerrar o vínculo: `ended_at` numa linha, 404 na requisição seguinte e um evento

- **Status:** aceito
- **Data:** 2026-11-11

## Contexto

O card I-07 fecha o ciclo de vida do vínculo que a ADR
[0016](./0016-aceite-do-convite-vinculo-e-consentimento.md) abriu: qualquer um
dos dois lados pode encerrar o acompanhamento, o histórico continua do
paciente, o acesso do profissional cai na hora e os planos ativos daquele
profissional são arquivados.

A tabela já estava pronta para isso — `identity.care_relationship` tem
`ended_at` desde a migração `0002`, a regra de acesso já recusa um vínculo
encerrado (`domain/patient-access.ts`, ADR
[0017](./0017-servico-de-acesso-ao-paciente.md)) e o aceite de convite já sabe
reativar um vínculo que havia terminado. O que faltava era quem escreve a data,
com que autorização, e o que o resto da plataforma faz quando ela é escrita.

Sete decisões não são óbvias:

1. **Um caso de uso ou dois?** Os dois lados pedem a mesma coisa com
   autorizações diferentes.
2. **Qual id cada lado usa**, já que não existe nenhuma rota que liste vínculos?
3. **O profissional precisa do consentimento de compartilhamento para
   encerrar?**
4. **Encerrar duas vezes é sucesso ou conflito?**
5. **O que o `404` do critério de aceite significa**, e quem o garante?
6. **Quem arquiva os planos**, se `nutrition` ainda é um esqueleto?
7. **Encerrar registra acesso?**

## Decisão

**Um caso de uso, `EndCareRelationshipUseCase`, com duas entradas**
(`byProfessional` e `byPatient`). O que muda entre os dois lados é quem pode
pedir e como a negativa é redigida; o que acontece depois — a linha datada, o
acesso perdido, o evento publicado — é uma coisa só e tem que continuar sendo
uma coisa só. Duas classes seriam dois lugares para isso, e a segunda seria a
que esquece o evento.

**Status continua sem coluna.** `active` e `ended` são lidos de `ended_at` no
instante em que alguém pergunta (`careRelationshipStatusOf`), como no convite
(ADR [0015](./0015-convite-por-link-com-token-hasheado.md)). O contrato
responde `status` porque o cliente não deve reimplementar a regra a partir de
uma data anulável — mas a fonte é a data, e não há linha que discorde do
relógio.

**Cada lado usa o id que já tem na mão.** O paciente encerra por id do vínculo
(`POST /v1/me/care-relationships/{careRelationshipId}/end`), que é o que o
aceite do convite devolveu a ele (`AcceptedInvitation.careRelationshipId`); o
profissional encerra por id do paciente
(`POST /v1/patients/{patientId}/care-relationship/end`), que é a chave de toda
rota de paciente do painel. **Nenhuma rota de listagem nasce aqui**: listar
vínculos é tela, e tela tem card próprio.

`POST .../end` e não `DELETE`, pelo mesmo motivo que revogar consentimento é
`POST`: nada é apagado. A linha fica, com as duas datas, e um `DELETE` diria a
todo cliente o contrário.

**O profissional encerra sem o consentimento de compartilhamento, e por isso
esta é a única rota de paciente que não fica atrás do
`@RequiresPatientAccess()`.** O decorator é a regra de quem **lê** um paciente
(ADR 0017) e exige `share_with_professional` vigente junto do vínculo ativo.
Aqui nada do paciente é lido, e paciente que revogou aquele consentimento
deixou um vínculo ativo para trás — consentimento e vínculo são registros
diferentes (ADR
[0018](./0018-consentimento-concedido-e-revogado.md)) —, então uma prática
atrás daquele guard não conseguiria fechar o próprio lado de um acompanhamento
que o paciente já abandonou. A autorização é do caso de uso e não é mais fraca:
o vínculo tem que ser de uma prática de que quem chamou é membro, e qualquer
outra coisa responde o mesmo 404 que o guard responderia.

**Encerrar de novo é 409** (`identity.care_relationship.already_ended`), como
revogar um consentimento que já não está vigente. Responder 200 datava a linha
de novo, anunciava um segundo encerramento aos outros módulos e dizia a quem
perguntou que algo aconteceu agora quando aconteceu num mês passado. A corrida
é decidida pelo banco: o `update` só toca linha com `ended_at is null`, então os
dois lados encerrando no mesmo instante datam a linha uma vez e o perdedor
recebe o mesmo 409.

**A negativa de cada lado é diferente, e de propósito.** Paciente de outra
prática é `identity.patient.not_found` (404), igual à regra de acesso, para que
a rota não seja um oráculo de ids de paciente; vínculo que não é do paciente que
chamou é `identity.care_relationship.not_found` (404), do mesmo jeito que um
convite de outra organização. O domínio responde um código
(`decideCareRelationshipToEnd`) e cada entrada do caso de uso traduz — é a
mesma forma de `decidePatientAccess`, pelo mesmo motivo: a regra é uma função
testável, não quatro linhas copiadas.

**O 404 do critério de aceite não é desta rota: é da regra de acesso, lida da
linha.** `PatientAccessService` lê o vínculo no instante da requisição e não
guarda cópia (ADR 0017), então a requisição seguinte ao encerramento já responde
404 — sem invalidação, sem job e sem nenhum subscriber precisar funcionar. O
teste de integração prova isso contra o Postgres de verdade, que é onde a regra
mora de fato (cinco tabelas, um join para `organization_member` e um índice
parcial).

**Nada é apagado, e a garantia é de tipo e de SQL.** A porta
`CareRelationshipRepository` não tem `delete` — não há como um caso de uso, um
job ou um módulo futuro remover a linha —, e o repositório Drizzle não tem uma
única instrução de remoção: o encerramento é um `update` de uma coluna.
`started_at`, `invitation_id`, o perfil, os consentimentos e tudo o que o
paciente registrou ficam exatamente como estavam.

**Quem arquiva os planos é `nutrition`, reagindo ao evento
`identity.relationship.ended`.** `identity` não sabe o que é um plano e não pode
saber (CLAUDE.md regra 2): o efeito colateral atravessa a fronteira como evento
(regra 3), com `careRelationshipId`, `organizationId`, `patientId`, `endedBy` e
`endedAt` — ids, um código e um instante, nunca dado pessoal. O handler que
falha é uma linha de log (`InMemoryEventBus`, ADR
[0009](./0009-eventos-internos-e-fila-de-jobs.md)) e não um acompanhamento
encerrado pela metade, porque o corte de acesso não depende dele.

**Encerrar não registra acesso.** `identity.logAccess` registra abrir a ficha e
exportar dados (ADR
[0019](./0019-registro-de-acessos-e-quem-viu-meus-dados.md)); encerrar não é
nenhum dos dois — nada do paciente foi lido — e uma linha ali diria que o
profissional viu algo que não viu.

## Consequências

- **Os planos ativos ainda não são arquivados por ninguém**, porque não existe
  plano: `nutrition` é um esqueleto. O evento está no catálogo, publicado e
  testado, e o card que criar o plano alimentar assina
  `identity.relationship.ended` e arquiva — é uma linha de subscrição, não uma
  mudança neste módulo. É a mesma situação em que a ADR 0019 deixou o
  interceptor de registro de acesso: o mecanismo pronto, o primeiro chamador no
  card dele. **Enquanto isso, um plano de uma prática que encerrou continua
  marcado como ativo na tabela que ainda não existe** — e nada o exibe, porque
  toda leitura passa pela regra de acesso.
- `insights` ganha o mesmo gancho para parar de gerar alerta para aquele
  profissional, no card dele.
- **Voltar a ser acompanhado pela mesma prática é aceitar um convite novo**, e
  isso já funciona: o aceite reativa a linha encerrada com `started_at` e
  `invitation_id` novos (ADR 0016). O histórico de "começou, terminou, começou
  de novo" **não** fica, porque o índice único no par (organização, paciente)
  tem uma linha só. Quando o produto quiser essa linha do tempo, ela é uma
  tabela de episódios — e um ADR novo.
- **Ninguém avisa o outro lado.** O paciente que foi liberado e o profissional
  que foi deixado descobrem na próxima vez que abrem o app ou o painel. Avisar
  é produto (push, e-mail) e tem decisão própria; o evento já carrega o que um
  aviso precisaria.
- As duas telas — "encerrar acompanhamento" no app e no painel — ficam para os
  cards de interface. O cliente TypeScript já é gerado com as duas operações; o
  Dart também, no `pnpm api:generate`.
- `PatientId` entra no contrato como componente próprio, porque esta é a
  primeira rota da API com um paciente no caminho. As rotas de ficha que virão
  usam o mesmo.
- **Id malformado responde 400** nas duas rotas, e não o 404 que o
  `PatientAccessGuard` escolheu para o mesmo caso. Não é incoerência de
  segurança — nada é consultado e todo uuid mal formado recebe a mesma
  resposta, então não há o que deduzir — é a validação do contrato acontecendo
  antes do handler, que é onde ela acontece em toda a API.
- A rota do profissional não fica atrás do guard, então é ela que tem que ser
  lida com cuidado no futuro: qualquer coisa que **leia** o paciente ali dentro
  precisa do guard ou do `assertCanAccessPatient`. Hoje ela não lê nada.
