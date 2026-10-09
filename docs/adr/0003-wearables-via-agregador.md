# 0003. Wearables via agregador atrás de uma porta própria

- **Status:** aceito
- **Data:** 2026-10-08

## Contexto

O valor do produto depende de cruzar alimentação com treino e sono, e os
pacientes usam relógios e anéis de fabricantes diferentes: Garmin, Apple Health,
Health Connect, WHOOP, Oura. Integrar cada fabricante direto significa manter
vários fluxos de OAuth, vários formatos de webhook e vários contratos — trabalho
recorrente que não diferencia o produto.

Há ainda uma restrição jurídica concreta: os termos do Strava proíbem exibir os
dados do atleta a um treinador e usá-los para alimentar IA, que são exatamente os
dois usos que o produto faz.

## Decisão

Usamos um agregador de wearables como fonte única de dados de dispositivo, e ele
fica atrás de uma porta própria: `WearableAggregator`, em
`health/application/ports`, com as operações de gerar sessão de conexão,
desconectar usuário, validar assinatura de webhook e buscar histórico.

Nenhum código fora do adaptador conhece o nome do agregador.

**Strava não é fonte de dados** e não entra na lista de provedores oferecidos.

O agregador concreto ainda não está escolhido — isso é decidido no card OP-04 e
não muda este ADR, que trata da forma da integração, não do fornecedor.

## Consequências

Trocar de agregador — por preço, cobertura de dispositivos ou fim de contrato —
mexe em um adaptador, não no domínio nem nos casos de uso.

Em troca, aceitamos uma dependência de terceiro no caminho crítico do produto:
se o agregador cai ou atrasa, ficamos sem dado novo. Alertas e resumos precisam
distinguir "paciente sem dados" de "paciente estável" para não dar falso
conforto ao profissional.

Como o agregador normaliza menos do que precisamos, a normalização na entrada é
nossa: UTC no banco, fuso do paciente no perfil, sistema métrico, e a noite de
sono identificada pela data em que começou.

Dado de wearable é gravado só por job ou webhook do backend, nunca editado por
usuário — é registro de medição, não entrada de formulário.

Os testes do adaptador usam respostas gravadas; o CI não chama o serviço real.
