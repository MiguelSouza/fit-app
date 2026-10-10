# 0006. Logger estruturado com pino e redação por nome de campo

- **Status:** aceito
- **Data:** 2026-10-10

## Contexto

O `CLAUDE.md` ("Saúde e LGPD") proíbe dado de saúde e dado pessoal em log, em
qualquer destino: CloudWatch, Sentry, Langfuse. Ao mesmo tempo, investigar um
problema de paciente sem poder citar o paciente exige que a linha de log tenha
id, rota e um jeito de amarrar as linhas de uma mesma requisição.

Confiar em quem escreve a chamada funciona até alguém logar uma entidade inteira
por descuido — e aí o vazamento já está no CloudWatch, com retenção. O logger
padrão do NestJS também não ajuda: escreve texto formatado para humano, sem
campos, o que torna uma busca em produção um `grep` sobre frase.

A API roda em ECS Fargate, onde o stdout da task é o stream do CloudWatch
([0005](./0005-aws-sa-east-1-e-vercel.md)): o que o processo imprime é o que vai
ser consultado depois.

## Decisão

A API loga com **pino**, uma linha JSON por evento, no stdout.

Três coisas ficam no logger, não na chamada:

1. **Redação por nome de campo.** Antes de serializar, todo campo cujo nome seja
   sensível — nome, e-mail, telefone, token, notas, valores de check-in e
   vizinhos — sai como `[redacted]`, em qualquer profundidade e dentro de array.
   A regra erra para o lado de mascarar. Usamos `formatters.log` e não a opção
   `redact` do pino porque esta exige caminho fixo (`a.b.email`) e o campo
   precisa cair mascarado onde quer que apareça.
2. **Mensagem de erro descartada.** Do erro ficam o tipo, o código e a pilha sem
   a primeira linha. Mensagem de driver cita o valor que quebrou a query.
3. **Correlation id por requisição**, em `AsyncLocalStorage`, estampado em toda
   linha escrita enquanto a requisição está no ar. Entra e sai pelo cabeçalho
   `x-correlation-id`.

Um adaptador liga o `LoggerService` do NestJS ao pino (`app.useLogger`), então
todo `new Logger('X')` que já existia passa a sair estruturado e com as mesmas
garantias, sem mudar nada no código.

Ficam **explicitamente de fora**:

- `nestjs-pino` e `pino-http`: o que eles dão por dependência é um provider, um
  middleware e um adaptador — três arquivos pequenos aqui, que é onde a política
  de redação e o id precisam morar de qualquer forma.
- `pino-pretty`: a linha JSON é legível o suficiente em desenvolvimento, e seria
  mais uma dependência lendo dado que não pode vazar.
- Sentry e Langfuse: estão no `.env.example` e entram nos seus cards. Quando
  entrarem, mandam dado para fora do processo e passam pela mesma redação.

## Consequências

Um campo sensível novo é uma linha na lista de
`shared/logging/sensitive-data.ts`, e passa a valer para a API toda — inclusive
para código escrito antes dele.

Em troca, há falso positivo: `fileName` e `hostname` saem mascarados num objeto
de log. Aceitamos, porque o custo é um inconveniente de leitura e o do erro
contrário é um vazamento.

A frase do log passa a ser fixa, com o dado no objeto — é o que a máscara
alcança. Quem interpolar o nome do paciente na própria frase vaza, e nenhuma
ferramenta pega isso: fica como item de revisão de PR.

Reverter significa trocar o logger e reescrever a redação em outro lugar, não
remover um pacote: a política de campos sensíveis é nossa, só a serialização é
do pino.
