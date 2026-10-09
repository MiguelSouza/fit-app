---
description: Lê um card do quadro Wellness no Trello, confere dependências e salva o conteúdo para os próximos passos
argument-hint: <ID do card, ex. F-03>
---
# Ler card

**Input**: $ARGUMENTS

1. No quadro "Wellness" do Trello, encontre o card cujo título começa com o ID informado.
2. Leia também o card "LEIA PRIMEIRO" e siga as regras dele.
3. Confira a seção "Depende de". Se algum card listado não estiver na lista "Feito", PARE:
   não implemente nada e explique qual dependência falta.
4. Mova o card para a lista "Fazendo".
5. Salve em $ARTIFACTS_DIR/card.md:
   - ID e título
   - link do card
   - contexto
   - o que fazer
   - critérios de aceite (como checklist)
   - fora do escopo

Se as ferramentas do Trello não estiverem disponíveis, PARE e diga isso claramente.
Não invente o conteúdo do card.
