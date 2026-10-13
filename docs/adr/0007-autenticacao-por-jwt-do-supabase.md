# 0007. Autenticação por JWT do Supabase: guard global, HS256 e segredo compartilhado

- **Status:** aceito
- **Data:** 2026-10-10

## Contexto

O login é do Supabase Auth e a regra de negócio é da API
([0002](./0002-supabase-como-infraestrutura.md)): o painel e o app fazem login
lá e mandam o access token aqui. A API precisa, a cada requisição, saber de quem
é o token e ter certeza de que foi o nosso projeto que o emitiu.

RLS não é a nossa linha de defesa, justamente porque cliente nenhum fala com o
banco. Então a única coisa entre uma requisição anônima e o dado de um paciente
é o que a API checa — e o que a API checa é código nosso, não configuração do
Supabase.

O Supabase assina o access token de duas formas: com o segredo do projeto
(HS256, uma chave simétrica, que já está no `.env.example` e sai do
`supabase status`) ou com chaves assimétricas publicadas num JWKS. Verificar um
JWT, em qualquer das duas, é checar assinatura, validar claims e comparar bytes
em tempo constante.

## Decisão

**Um guard global** (`APP_GUARD`, como o filtro de erros) na frente de toda rota.
Uma rota só responde sem token se disser `@Public()`; um controller novo nasce
protegido por existir. A assimetria é o motivo de ser global: esquecer o
decorator numa rota aberta dá 401 e alguém percebe, enquanto o contrário — uma
rota de paciente aberta por esquecimento — não acontece.

**HS256 com o segredo do projeto**, em `SUPABASE_JWT_SECRET`, obrigatório no
ambiente: API que não sabe verificar token não responde requisição nenhuma, e
isso falha no boot, não na primeira chamada. Menos de 32 caracteres é recusado.

**O algoritmo é fixado** na verificação. Sem isso, o header do próprio token
escolheria como ele é verificado, que é a confusão de algoritmo; `alg: none` a
biblioteca já recusa sozinha.

**Checamos assinatura, expiração e audiência** (`aud: authenticated`), e
exigimos `sub`, `exp` e `role`.

**`@CurrentUser()` devolve id e papel, e nada mais.** O token também carrega
e-mail e telefone, que não têm o que fazer circulando pela aplicação nem caindo
em log (`CLAUDE.md`, "Saúde e LGPD"). O papel sai do claim `role` e nunca de
`user_metadata`, que o próprio usuário escreve.

**A dependência é o `jose`**: a verificação é criptografia, não vale escrever à
mão, e o `jose` fixa algoritmo, valida claims e não traz dependência nenhuma
atrás de si.

Ficam **explicitamente de fora**:

- **Chaves assimétricas e JWKS.** Significam chamada de rede no caminho da
  requisição e um cache de chaves para manter. Com segredo compartilhado, quem
  não o tem não produz assinatura que passe. Trocar depois é
  `supabase-token-verifier.ts` e uma variável.
- **Checar o `iss`.** Com chave simétrica, só o projeto que tem o segredo
  assina algo que passe: o issuer seria mais uma variável e nenhuma garantia
  nova. Entra junto com as chaves assimétricas, se elas entrarem.
- **Passport e `@nestjs/jwt`.** O que eles dariam aqui é um guard e um
  verificador — dois arquivos pequenos, que é onde a política de rota pública e
  o formato do 401 precisam morar de qualquer jeito.
- **Autorização.** Vínculo ativo, consentimento vigente e `professional_type`
  são outra pergunta, respondida pelo serviço de acesso do `identity` dentro do
  caso de uso, e dão 403. Este ADR é sobre quem está chamando, não sobre o que
  essa pessoa pode ver.
- **Refresh token, revogação e logout.** São do Supabase Auth. A API só lê um
  token de curta duração (`jwt_expiry = 3600` no `supabase/config.toml`).

## Consequências

Rota nova é protegida por padrão, e o custo é lembrar do `@Public()` nas poucas
que não são: `/v1/health`, que uma sonda do ALB chama sem sessão, e o aceite de
convite, que é alguém sem conta ainda.

A autenticação fica em `shared/auth`, não no módulo `identity`, porque é
infraestrutura que atravessa todos os módulos e não toca no banco. O
`identity` continua dono da autorização, e `AuthenticatedUser` é o sujeito que
ela vai receber.

O 401 tem um texto só, para qualquer motivo. Quem está tentando token não
aprende nada pela resposta; quem precisa investigar lê o código do motivo no
log (`missing`, `expired`, `signature`, `audience`, `algorithm`, `claims`), que
nunca vem acompanhado do token nem de pedaço dele.

Um token sem `role` é recusado em vez de ganhar um valor padrão. É mais estrito
que o necessário hoje, e de propósito: 401 aparece, papel inventado não.

O segredo passa a ser requisito de ambiente em todo lugar que sobe a API — ECS,
CI, máquina de quem desenvolve — e requisito do `drizzle.config.ts`, que lê o
mesmo carregador. Rotacionar o segredo no Supabase invalida todo token emitido
e precisa ser feito junto com o deploy da API.

Reverter não é remover um pacote: o guard, o `@Public()` e o formato do 401 são
nossos. Só a verificação é do `jose`.
