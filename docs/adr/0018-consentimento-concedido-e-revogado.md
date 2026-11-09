# 0018. Consentimento concedido e revogado: registro imutável, cascata do `health_data` e um evento

- **Status:** aceito
- **Data:** 2026-11-09

## Contexto

O card I-05 dá ao paciente o controle do que a plataforma pode fazer com os
dados dele: conceder e revogar cada finalidade, e ver o que está vigente. A
tabela `identity.consent` já existe, do card I-03 (ADR
[0016](./0016-aceite-do-convite-vinculo-e-consentimento.md)), com uma linha por
finalidade, `terms_version`, `granted_at`, `revoked_at` e o índice único parcial
sobre as vigentes. O que falta é quem escreve nela depois do aceite, e com que
regras.

O `CLAUDE.md` é explícito em dois pontos que decidem quase tudo aqui:
"revogar consentimento corta o acesso na hora. Não guardar cópias em cache que
ignorem isso", e "dados para a IA só com consentimento `ai_processing`
vigente". E o card acrescenta uma pergunta que ele mesmo não responde:
**"revogar `health_data` encerra o uso do app: definir comportamento e
documentar"**.

Cinco decisões não são óbvias:

1. **O que "revogar `health_data` encerra o uso do app" significa em linhas de
   banco?** Cai tudo? Termina o vínculo? Apaga dado?
2. **Pode o paciente conceder `ai_processing` sem `health_data`?**
3. **Quem avisa os outros módulos**, e eles são responsáveis por cortar o
   acesso?
4. **Conceder uma finalidade já vigente é erro ou é nada?**
5. **Que rotas HTTP isso vira**, e quem pode chamá-las?

## Decisão

**`health_data` é a finalidade fundante, e revogá-la revoga todas as vigentes
na mesma transação.** As outras três são coisas feitas **sobre** o dado de
saúde — compartilhar com o profissional, importar do wearable, mandar para a IA
—, então nenhuma delas pode valer sem a permissão de guardar o dado. A cascata é
decidida no domínio (`consentsToRevoke`) e escrita em um `update` só, dentro de
transação: paciente que revogou a base e ficou com `ai_processing` ligado é um
estado que ninguém deveria conseguir alcançar, nem por meia requisição que
falhou. O efeito prático é o que o card chama de encerrar o uso do app — sem
`health_data` não há check-in para registrar, sem `share_with_professional` o
profissional não vê nada (ADR
[0017](./0017-servico-de-acesso-ao-paciente.md)), sem `wearable_data` a
sincronização para e sem `ai_processing` não há resumo.

**A simetria é a regra de concessão:** nenhuma finalidade pode ser concedida
enquanto `health_data` não estiver vigente
(`identity.consent.health_data_required`, 422). Sem isso, quem revogou tudo
poderia religar `ai_processing` e a plataforma estaria processando dado que não
tem permissão de guardar. A volta existe e é um toque: concede `health_data`
primeiro, e depois as que quiser.

**O que a revogação NÃO faz:** não encerra o vínculo com a prática e não apaga
nada. O `care_relationship` é a trilha de auditoria de por que aquela prática um
dia viu aquele paciente (ADR 0016), e o acesso já está cortado pela regra que lê
a linha na hora — encerrar o acompanhamento é ato da prática, com card próprio,
e **eliminação de dado é outro direito**, com outro card e outras
consequências (o que o profissional prescreveu não desaparece porque o paciente
desinstalou o app). Esta é a parte da decisão que mais merece ser lida antes de
alguém "melhorar" a revogação.

**Revogar nunca apaga: `revoked_at` é preenchido e a linha fica.** Não existe
`delete` em nenhum arquivo deste card. O `update` só toca linhas que ainda têm
`revoked_at` nulo, então `granted_at` e `terms_version` ficam como estavam e a
segunda revogação da mesma finalidade não sobrescreve o primeiro instante —
responde 409 (`identity.consent.not_in_force`). Conceder de novo depois de
revogar cria uma **linha nova** ao lado da antiga, e o índice parcial permite
porque só uma das duas está vigente: o histórico de "deu, tirou e deu de novo"
sobrevive, que é o que permite responder, um ano depois, o que era permitido
quando.

**Conceder é idempotente e não é erro.** Finalidade já vigente não escreve nada
e a resposta é o consentimento que já existe, com a data e a versão do termo
originais — toque duplo e retentativa de rede são o mesmo estado do mundo, e
"dar de novo" não deve reescrever o dia em que a pessoa concordou nem mudá-lo
para o termo de hoje. O desempate em corrida é do banco, pelo índice parcial,
não deste processo.

**A versão do termo é decidida pela API** (`CURRENT_TERMS_VERSION`), nunca
enviada pelo cliente: o que a pessoa aceitou é o texto que esta API serviu, e um
campo no corpo deixaria um chamador registrar concordância com uma versão que
nunca foi mostrada.

**Só o próprio paciente concede e revoga** (`identity.patient.required`, 403).
Consentimento é pessoal: ninguém dá nem tira pelo outro, nem o profissional que
acompanha. O sujeito vem do `sub` do token verificado (ADR
[0007](./0007-autenticacao-por-jwt-do-supabase.md)) e **as rotas ficam sob
`/v1/me/consents`**, sem id de paciente em lugar nenhum — não há o que um
profissional aponte para outra pessoa. E nada que o profissional tenha impede a
revogação: ela não pede vínculo, prática nem o próprio
`share_with_professional`, que é justamente o que pode estar sendo retirado.

**Três rotas**, finas como as demais: `GET /v1/me/consents` (o que está
vigente, com data e versão do termo), `POST /v1/me/consents` (uma finalidade por
requisição, 201) e `POST /v1/me/consents/{type}/revoke` (200, respondendo uma
**lista** — por causa da cascata do `health_data`). `POST .../revoke` e não
`DELETE`, como no convite e por um motivo mais forte: revogar não é apagar, e um
`DELETE` diria a todo cliente o contrário.

**A revogação publica `identity.consent.revoked`, uma vez por finalidade
encerrada** (`profileId`, `consentType`, `revokedAt` — ids, códigos e um
instante, nunca dado pessoal). Um evento por finalidade, e não um com a lista,
para que um assinante leia a finalidade que lhe interessa sem precisar conhecer
a cascata. É o módulo `identity` anunciando pela primeira vez, e é o gancho de
"parar a sincronização de wearable" e "não gerar resumo por IA".

**Nenhum assinante está no caminho do corte de acesso.** Isso é deliberado e é o
ponto mais importante do evento: o profissional perde acesso porque a regra lê a
linha no instante da requisição e não cacheia nada (ADR 0017), não porque alguém
reagiu a tempo. Handler que falha é uma linha de log (`InMemoryEventBus`), não um
paciente exposto. **Conceder não publica evento** — concessão amplia o que é
permitido e nada precisa ser interrompido às pressas; quem se importa lê o
consentimento no instante em que precisa.

**Nada é logado nos três casos de uso.** Quais finalidades alguém consentiu ou
revogou é dado pessoal sobre a saúde da pessoa (`CLAUDE.md`, "Saúde e LGPD"), e
não há uma linha de log nesses arquivos.

## Consequências

- O app do paciente ganha a tela de consentimentos: lista, um interruptor por
  finalidade e um aviso claro no `health_data`, que derruba as outras. O
  cliente Dart já é gerado com as três operações.
- **Revogar `health_data` deixa o paciente com a conta ativa e nada vigente.**
  O perfil, o vínculo e as linhas de consentimento continuam lá; o app abre, e
  o que ele tem a oferecer é a tela que pede `health_data` de novo. É esse o
  "encerra o uso do app" desta entrega — não é exclusão de conta, que é outro
  direito e outro card.
- O profissional não é avisado de que perdeu acesso. A ficha simplesmente
  responde 404 (ADR 0017), com a mesma mensagem de "paciente não encontrado",
  e nada na resposta diz qual das condições falhou. Avisar a prática que um
  paciente revogou o compartilhamento é produto, não autorização, e precisa de
  decisão própria.
- Não existe consentimento por profissional: revogar `share_with_professional`
  corta **todas** as práticas de uma vez. É herança consciente do ADR 0016 —
  para cortar uma só, o que termina é o vínculo.
- `health` e `insights` ainda não assinam o evento; eles são esqueletos. Quando
  assinarem, a linha que escrevem é `imports: [EventsModule]` e um `subscribe`
  no bootstrap, e nenhum deles toca `identity.consent`.
- Duas portas escrevem a mesma tabela — esta e a do aceite (ADR 0016), que
  grava os consentimentos dentro da transação que cria o paciente. O que as
  mantém coerentes é o índice único parcial, que está no banco e não em um
  acordo entre as duas.
- **A cascata é atômica, mas a leitura que a decide acontece antes dela.** Cada
  caso de uso lê o que está vigente e decide fora da transação que escreve, o
  que deixa uma janela estreita: se o mesmo paciente revogar `health_data` e
  conceder `wearable_data` ao mesmo tempo, a concessão pode ser gravada depois
  da cascata e ficar vigente sem a base. É o único caminho conhecido para o
  estado que esta decisão proíbe, ele exige duas requisições concorrentes e em
  sentidos opostos da mesma pessoa, e fechá-lo é serializar a escrita por perfil
  (lock por `profile_id`, ou decidir a cascata dentro da transação) — mudança
  de porta que fica para quando houver motivo. Enquanto isso, o corte de acesso
  do profissional não depende disso: ele lê a linha no instante da requisição
  (ADR 0017).
- Fica de fora o histórico para o paciente. As linhas revogadas são guardadas
  para sempre e `GET /v1/me/consents` responde só o vigente: a pergunta da tela
  é "o que a plataforma pode fazer com os meus dados hoje". Uma tela de
  histórico é produto, e tem o dado para ser construída quando for pedida.
- Fica de fora a mudança de versão do termo. Quando `CURRENT_TERMS_VERSION`
  mudar, os consentimentos vigentes continuam dizendo o texto antigo — correto,
  e insuficiente: pedir reconsentimento é fluxo novo, com card próprio.
