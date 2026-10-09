import { describe, expect, test } from 'bun:test';

import { dependencies } from './trello.ts';

/**
 * The dependency gate is the one thing here that can fail silently: if the
 * parser returns nothing, every card looks ready and the workflow happily
 * starts work on a card whose dependency is still open. The first version of
 * it did exactly that, so these cases exist to keep it honest.
 */
describe('dependencies', () => {
  test('reads the ids listed under the heading', () => {
    const desc = [
      '## O que fazer',
      '- NestJS em `apps/api`.',
      '',
      '## Depende de',
      'F-01, F-03',
    ].join('\n');

    expect(dependencies(desc)).toEqual(['F-01', 'F-03']);
  });

  test('reads a single id', () => {
    expect(dependencies('## Depende de\nF-01')).toEqual(['F-01']);
  });

  test('reads ids written as a list, over several lines', () => {
    expect(dependencies('## Depende de\n- F-01\n- IA-02\n- OP-05')).toEqual([
      'F-01',
      'IA-02',
      'OP-05',
    ]);
  });

  test('stops at the next heading', () => {
    const desc = ['## Depende de', 'F-01', '', '## Fora do escopo', 'F-09 e F-13'].join('\n');
    expect(dependencies(desc)).toEqual(['F-01']);
  });

  test('ignores ids mentioned anywhere else in the card', () => {
    const desc = [
      '## Contexto',
      'Parecido com o F-99, mas sem o painel do F-13.',
      '',
      '## Critérios de aceite',
      '- [ ] Igual ao F-42.',
    ].join('\n');

    expect(dependencies(desc)).toEqual([]);
  });

  test('returns nothing when the card has no such heading', () => {
    expect(dependencies('## O que fazer\n- qualquer coisa')).toEqual([]);
  });

  test('survives CRLF, which is how a Windows paste arrives', () => {
    expect(dependencies('## Depende de\r\nF-01, F-03')).toEqual(['F-01', 'F-03']);
  });

  test('does not repeat an id listed twice', () => {
    expect(dependencies('## Depende de\nF-01, F-01')).toEqual(['F-01']);
  });
});
