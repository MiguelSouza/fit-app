# 0015. Convite por link: token aleatório, guardado como hash, mostrado uma vez

- **Status:** aceito
- **Data:** 2026-10-29

## Contexto

O card I-02 pede o convite de paciente por link: o nutricionista gera o link,
manda pelo WhatsApp, e o paciente entra por ele. Os critérios de aceite dizem
três coisas sobre esse link — pertence à organização do profissional, o token
não é previsível e não aparece em log, e convite expirado ou revogado não pode
ser aceito.

Cada uma dessas frases é uma decisão que o resto do módulo vai herdar, porque
todo convite que vier depois (reenvio, convite de clínica, convite de outro
profissional para a mesma organização) usa a mesma tabela:

1. **O que é guardado do token?** O caminho curto é uma coluna com o token em
   texto puro: a lista de convites pode mostrar o link de novo, reenviar é
   trivial, e o `CLAUDE.md` já garante que nada chamado `token` entra em log
   (`packages/observability`).
2. **De quem é o convite?** Do profissional que mandou, ou da organização?
   No MVP é a mesma coisa — cada nutricionista tem a sua organização `solo`
   (ADR [0014](./0014-modelo-de-identidade-e-organizacao-solo.md)).
3. **Onde fica a situação do convite?** Pendente, aceito, expirado e revogado
   são quatro estados, e o mais natural é uma coluna `status`.
4. **Para onde o link aponta?** A tela que o paciente abre não existe: aceitar
   o convite é o card do vínculo profissional–paciente.

## Decisão

**O banco guarda o SHA-256 do token, nunca o token.** `identity.invitation`
tem `token_hash` com índice único, e o token em texto puro é respondido **uma
única vez**, na resposta do `POST /v1/invitations`. O token é 256 bits de
`randomBytes` em `base64url` (43 caracteres, nada para escapar numa URL), e o
hash é um SHA-256 simples, sem salt e sem fator de trabalho: isto não é senha
— uma senha é curta, escolhida por gente e chutável, e é isso que bcrypt existe
para atrasar; um token de 256 bits aleatórios não tem vizinhança para chutar.
O que o hash compra é o que importa: um dump, um backup ou uma réplica deste
banco não contém link que funcione. E o digest determinístico é o que vai
permitir ao aceite achar a linha por índice único.

A consequência é deliberada: **quem perder o link não o recupera**. Não há
"mostrar de novo" nem "reenviar" — revoga o convite e cria outro, que é uma
linha a mais na tabela e dois cliques na tela. É a mesma troca que um token
pessoal do GitHub faz, pela mesma razão.

**O convite pertence à organização, e a organização vem de quem chama.** A
coluna é `organization_id`; `invited_by_profile_id` registra quem mandou, mas
não é o dono. Nenhuma requisição nomeia organização: `LoadProfessionalCaller`
resolve a prática a partir do `sub` do token verificado, e toda consulta do
repositório é escopada por ela — inclusive a que já tem a chave primária na
mão. Convite de outra organização responde **404**, não 403: profissional não
tem o que saber sobre id que não é dele.

**Não existe coluna de situação.** `pending`, `accepted`, `expired` e
`revoked` são lidos de três instantes (`expires_at`, `accepted_at`,
`revoked_at`) por `domain/invitation.ts`, no momento em que alguém pergunta.
Coluna de status precisaria de um job virando `pending` em `expired` à
meia-noite, e estaria errada no intervalo entre a hora e o job. O cliente
recebe a palavra pronta da API, e nenhum painel ou app recalcula nada — um
relógio de navegador uma hora adiantado não pode mostrar como morto um link que
funciona.

**A regra do aceite já existe, mesmo sem o caso de uso.**
`invitationReadyToAccept` recusa convite aceito, revogado ou expirado, com um
erro de domínio para cada um, e está testada. É o critério "convite expirado ou
revogado não pode ser aceito" escrito onde ele vale, antes do fluxo que vai
lê-lo: quem escrever o aceite chama essa função e ganha a recusa de graça.
Revogar, do seu lado, só funciona em convite pendente, e a condição está
**também** no `where` do `update`, para que uma revogação e um aceite no mesmo
instante sejam decididos pelo banco e não pelo que o processo leu um momento
antes.

**O link mora na origem do painel: `/convite/<token>`.** O token vai no
caminho, nunca em query string — query string é a parte que vaza, para
`Referer`, para analytics e para o log de quem estiver na frente, e é
exatamente o que o filtro do Sentry desta plataforma descarta. A base é
`location.origin`, a mesma origem onde o profissional já está, então não há
variável de ambiente nova e não há como o link apontar para o host errado.

## Consequências

- `POST /v1/invitations` responde **201** com `{ invitation, token }`, e é a
  única resposta de toda a API que carrega um token. O campo se chama `token`
  de propósito: é nome que a lista de mascaramento de
  `@fit-app/observability` cobre, então um objeto que caia num log sai com
  `[redacted]` no lugar.
- A lista (`GET /v1/invitations`) **não** tem como mostrar o link. A tela de
  convites, por isso, não tem botão de copiar: tem "revogar" no que está
  pendente, e o link aparece só na hora em que é gerado.
- Reenviar o mesmo convite não existe e não vai existir nesta tabela: o próximo
  card que quiser "reenviar" cria um convite novo e revoga o antigo.
- `name` e `contact` do convite são dado pessoal de alguém que ainda não é
  usuário da plataforma. Ficam na tabela e voltam para a tela do profissional
  que os digitou, e nunca para log nenhum — `contact` entrou na lista de
  campos mascarados, nos dois idiomas (TypeScript e o gêmeo em Dart).
- O link gerado hoje aponta para uma rota do painel que **ainda não existe**:
  `/convite/<token>` é do card do vínculo profissional–paciente, que é quem
  valida o token e cria a conta do paciente. O formato do link já está
  decidido, então aquele card preenche a tela sem mexer em nada do que foi
  gerado antes.
- Um convite expirado nunca é apagado nem reescrito. A linha fica, e a lista do
  profissional continua dizendo o que aconteceu com cada link — o que custa uma
  linha por convite e responde "eu convidei essa pessoa?" um mês depois.
