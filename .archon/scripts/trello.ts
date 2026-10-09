/**
 * Trello access for the `card-simples` workflow, with no AI in the loop.
 *
 * Reading and moving a card is mechanical, so it runs here instead of in a
 * prompt: it is faster, cheaper, and it cannot invent a card that does not
 * exist. The AI nodes only ever see the file this writes.
 *
 * Two subcommands:
 *
 *   bun .archon/scripts/trello.ts card              # reads $ARGUMENTS, prints card.md
 *   bun .archon/scripts/trello.ts finish <pr-url>   # comments the PR and moves the card
 *
 * Credentials come from `~/.archon/.env` (TRELLO_API_KEY, TRELLO_TOKEN), which
 * Archon injects into bash: and script: nodes. They are never printed, not even
 * on failure.
 */

const API = 'https://api.trello.com/1';

/** Lists this script reads and writes. Must match the board exactly. */
const LIST_DOING = 'Fazendo';
const LIST_REVIEW = 'Revisão';
const LIST_DONE = 'Feito';

/** Card ids on the board: F-04, IA-03, OP-01, ... */
const CARD_ID = /\b([A-Z]{1,2}-\d{1,3})\b/;

interface TrelloList {
  id: string;
  name: string;
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  shortUrl: string;
}

interface TrelloBoard {
  id: string;
  name: string;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    fail(
      `A variável ${name} não está definida.\n` +
        `Preencha ~/.archon/.env com TRELLO_API_KEY e TRELLO_TOKEN ` +
        `(gere os dois em https://trello.com/power-ups/admin, aba "API key").`,
    );
  }
  return value.trim();
}

/**
 * Compares list and card names ignoring case and accents, so a board renamed
 * from "Revisão" to "Revisao" does not break the run.
 */
function sameName(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  return normalize(a) === normalize(b);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const key = requireEnv('TRELLO_API_KEY');
  const token = requireEnv('TRELLO_TOKEN');

  const url = new URL(`${API}${path}`);
  url.searchParams.set('key', key);
  url.searchParams.set('token', token);

  const response = await fetch(url, init);
  if (!response.ok) {
    // The URL carries the credentials, so report the path only.
    const body = (await response.text()).slice(0, 400);
    fail(`Trello respondeu ${response.status} em ${path}: ${body}`);
  }
  return (await response.json()) as T;
}

async function findBoard(): Promise<TrelloBoard> {
  const wanted = process.env.TRELLO_BOARD ?? 'Wellness';
  const boards = await api<TrelloBoard[]>('/members/me/boards?fields=name');
  const board = boards.find((b) => sameName(b.name, wanted));
  if (!board) {
    const names = boards.map((b) => `"${b.name}"`).join(', ');
    fail(`Não achei o quadro "${wanted}". Os quadros desta conta são: ${names || '(nenhum)'}.`);
  }
  return board;
}

/**
 * Resolves a list by name and fails with the real list names when it is
 * missing, which is what a renamed column looks like from here.
 */
function listByName(lists: TrelloList[], name: string): TrelloList {
  const list = lists.find((l) => sameName(l.name, name));
  if (!list) {
    const names = lists.map((l) => `"${l.name}"`).join(', ');
    fail(`O quadro não tem a lista "${name}". As listas são: ${names}.`);
  }
  return list;
}

function cardById(cards: TrelloCard[], id: string): TrelloCard {
  const matches = cards.filter((c) => CARD_ID.exec(c.name)?.[1] === id);
  if (matches.length === 0) fail(`Não achei nenhum card começando com "${id}" no quadro.`);
  if (matches.length > 1) {
    fail(`Mais de um card começa com "${id}": ${matches.map((c) => c.name).join(' | ')}.`);
  }
  return matches[0] as TrelloCard;
}

/** Reads the ids under the card's "Depende de" heading. */
function dependencies(desc: string): string[] {
  const section = /^##\s*Depende de\s*$([\s\S]*?)(?=^##\s|\s*$)/m.exec(desc);
  if (!section?.[1]) return [];
  return [...section[1].matchAll(new RegExp(CARD_ID.source, 'g'))].map((m) => m[1] as string);
}

async function board() {
  const found = await findBoard();
  const [lists, cards] = await Promise.all([
    api<TrelloList[]>(`/boards/${found.id}/lists?fields=name`),
    api<TrelloCard[]>(`/boards/${found.id}/cards?fields=name,desc,idList,shortUrl`),
  ]);
  return { lists, cards };
}

function argumentsCardId(): string {
  const input = process.env.ARGUMENTS ?? process.env.USER_MESSAGE ?? '';
  const id = CARD_ID.exec(input)?.[1];
  if (!id) {
    fail(
      `Não achei um ID de card no input do workflow ("${input.slice(0, 80)}").\n` +
        `Rode como: archon workflow run card-simples F-04`,
    );
  }
  return id;
}

/**
 * Prints the card as markdown, verbatim. Not summarizing is the point: the
 * agent downstream must read what the card says, not a retelling of it.
 */
async function readCard(): Promise<void> {
  const id = argumentsCardId();
  const { lists, cards } = await board();
  const card = cardById(cards, id);
  const currentList = lists.find((l) => l.id === card.idList);

  const blocking = dependencies(card.desc)
    .map((depId) => {
      const dep = cards.find((c) => CARD_ID.exec(c.name)?.[1] === depId);
      const list = dep ? lists.find((l) => l.id === dep.idList)?.name : undefined;
      return { depId, found: dep !== undefined, list };
    })
    .filter((dep) => !dep.found || !sameName(dep.list ?? '', LIST_DONE));

  if (blocking.length > 0) {
    const detail = blocking
      .map((d) => (d.found ? `${d.depId} está em "${d.list}"` : `${d.depId} não existe no quadro`))
      .join('; ');
    fail(`${id} depende de card que não está em "${LIST_DONE}": ${detail}. Não implemente nada.`);
  }

  if (!sameName(currentList?.name ?? '', LIST_DOING)) {
    const doing = listByName(lists, LIST_DOING);
    await api(`/cards/${card.id}?idList=${doing.id}`, { method: 'PUT' });
  }

  process.stdout.write(
    [
      `# ${card.name}`,
      ``,
      `- **ID:** ${id}`,
      `- **Link:** ${card.shortUrl}`,
      `- **Lista na entrada:** ${currentList?.name ?? '(desconhecida)'} → ${LIST_DOING}`,
      ``,
      `> O que segue é a descrição do card, copiada sem alteração. Se algo que você`,
      `> precisa não estiver aqui, não invente: pare e diga o que falta.`,
      ``,
      card.desc.trim(),
      ``,
    ].join('\n'),
  );
}

/** Comments the PR link on the card and moves it to review. */
async function finishCard(prUrl: string | undefined): Promise<void> {
  if (!prUrl || !/^https:\/\/github\.com\/\S+\/pull\/\d+/.test(prUrl)) {
    fail(`Esperava a URL do PR como argumento, e recebi "${prUrl ?? ''}".`);
  }

  const id = argumentsCardId();
  const { lists, cards } = await board();
  const card = cardById(cards, id);
  const review = listByName(lists, LIST_REVIEW);

  const text = `PR aberto para este card: ${prUrl}`;
  await api(`/cards/${card.id}/actions/comments?text=${encodeURIComponent(text)}`, {
    method: 'POST',
  });
  await api(`/cards/${card.id}?idList=${review.id}`, { method: 'PUT' });

  console.log(`${id}: comentei o PR e movi o card para "${review.name}".`);
}

const [subcommand, ...rest] = process.argv.slice(2);

switch (subcommand) {
  case 'card':
    await readCard();
    break;
  case 'finish':
    await finishCard(rest[0]);
    break;
  default:
    fail(`Subcomando desconhecido: "${subcommand ?? ''}". Use "card" ou "finish".`);
}
