import { REDACTED } from '@fit-app/observability';
import {
  NodeClient,
  captureEvent,
  defaultStackParser,
  setCurrentClient,
  type Event,
} from '@sentry/node';

import { type SentryConfig } from '../config/env';
import { reportUnexpectedError, sentryOptions } from './sentry';

/**
 * The second acceptance criterion of card F-16: *teste prova que dados
 * sensíveis não saem no evento*.
 *
 * It is written against the **real SDK** and reads the envelope the transport
 * would have put on the wire, not the return of `beforeSend`. The difference
 * matters: between our filter and the network there is the SDK's own
 * serialization, its default integrations and whatever it decided to attach,
 * and a test of the filter alone would pass while the event went out with an
 * e-mail the SDK found somewhere.
 *
 * Every value here is synthetic (CLAUDE.md, "Testes").
 */
const CONFIG: SentryConfig = {
  dsn: 'https://examplekey@o0.ingest.sentry.io/1',
  environment: 'test',
  release: 'api@test',
};

/** Synthetic patient data, which is what must never show up in an envelope. */
const PERSONAL = {
  name: 'Ana Souza',
  email: 'ana.souza@example.com',
  phone: '+5511999998888',
  note: 'dormiu mal e acordou com dor no joelho',
  weight: 61.4,
  token: 'eyJhbGciOiJIUzI1NiJ9.synthetic.token',
};

const USER_ID = 'c0ffee00-0000-4000-8000-000000000001';

interface Sent {
  readonly events: Event[];
}

/**
 * Starts a client with the options the API uses and a transport that keeps
 * what it was given instead of sending it.
 *
 * `integrations: []` on purpose: the default ones read the machine (modules,
 * context, uncaught exceptions) and have nothing to do with what is being
 * asserted. What they could add is covered by the filter itself, which masks
 * by field name whatever it does not recognise.
 */
function startClient(): { client: NodeClient; sent: Sent } {
  const events: Event[] = [];

  const client = new NodeClient({
    ...sentryOptions(CONFIG),
    stackParser: defaultStackParser,
    integrations: [],
    transport: () => ({
      send: (envelope: [unknown, [unknown, unknown][]]) => {
        for (const [, payload] of envelope[1]) events.push(payload as Event);

        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    }),
  });

  setCurrentClient(client);
  client.init();

  return { client, sent: { events } };
}

describe('the Sentry client of the API', () => {
  let client: NodeClient;
  let sent: Sent;

  beforeEach(() => {
    ({ client, sent } = startClient());
  });

  afterEach(async () => {
    await client.close();
  });

  async function flushed(): Promise<Event> {
    await client.flush(2000);

    const [event] = sent.events;
    if (event === undefined) throw new Error('no event reached the transport');

    return event;
  }

  /** Everything the envelope would carry, as one string to search through. */
  async function flushedText(): Promise<string> {
    return JSON.stringify(await flushed());
  }

  it('reports the error, with the environment and the release on it', async () => {
    reportUnexpectedError(new Error('boom'), { correlationId: 'req_1' });

    const event = await flushed();

    expect(event.environment).toBe('test');
    expect(event.release).toBe('api@test');
    expect(event.exception?.values?.[0]?.type).toBe('Error');
    expect(event.tags?.correlationId).toBe('req_1');
  });

  it('identifies the caller by id and by nothing else', async () => {
    reportUnexpectedError(new Error('boom'), { userId: USER_ID, method: 'POST', path: '/v1/me' });

    const event = await flushed();

    expect(event.user).toEqual({ id: USER_ID });
    expect(event.tags).toMatchObject({ method: 'POST', path: '/v1/me' });
  });

  it('masks the message of the error, which can quote a column value', async () => {
    // A Postgres message does exactly this: `Key (email)=(...) already
    // exists`. The type and the stack say where it broke, which is what
    // debugging needs (`safe-error.ts`, same reasoning).
    reportUnexpectedError(
      new Error(`duplicate key value violates unique constraint (email)=(${PERSONAL.email})`),
      {},
    );

    const event = await flushed();

    expect(event.exception?.values?.[0]?.value).toBe(REDACTED);
    expect(JSON.stringify(event)).not.toContain(PERSONAL.email);
  });

  it("keeps the stack, which is ours, and drops the locals, which are the patient's", async () => {
    const event: Event = {
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'cannot read properties of undefined',
            stacktrace: {
              frames: [
                {
                  filename: '/app/dist/modules/health/check-in.js',
                  lineno: 42,
                  function: 'saveCheckIn',
                  vars: { patient: PERSONAL.name, weight: PERSONAL.weight },
                },
              ],
            },
          },
        ],
      },
    };

    captureEvent(event);

    const sentEvent = await flushed();
    const [frame] = sentEvent.exception?.values?.[0]?.stacktrace?.frames ?? [];

    expect(frame?.filename).toBe('/app/dist/modules/health/check-in.js');
    expect(frame?.lineno).toBe(42);
    expect(frame?.vars).toBeUndefined();
  });

  it('strips the request down to its method and its path', async () => {
    captureEvent({
      request: {
        method: 'POST',
        url: 'https://api.fit-app.example/v1/patients?busca=Ana%20Souza',
        query_string: 'busca=Ana%20Souza',
        data: { notes: PERSONAL.note, weight: PERSONAL.weight },
        cookies: { 'sb-access-token': PERSONAL.token },
        headers: { authorization: `Bearer ${PERSONAL.token}`, 'user-agent': 'fit-app/1.0' },
      },
    });

    const event = await flushed();

    expect(event.request).toEqual({
      method: 'POST',
      url: 'https://api.fit-app.example/v1/patients',
    });
  });

  it('empties the user of everything but the id, wherever it came from', async () => {
    captureEvent({
      user: {
        id: USER_ID,
        email: PERSONAL.email,
        username: PERSONAL.name,
        ip_address: '203.0.113.7',
      },
    });

    expect((await flushed()).user).toEqual({ id: USER_ID });
  });

  it('drops a user with no id rather than sending what is left of it', async () => {
    captureEvent({ user: { email: PERSONAL.email, username: PERSONAL.name } });

    expect((await flushed()).user).toBeUndefined();
  });

  it('masks by field name whatever was put in extra, contexts and tags', async () => {
    captureEvent({
      extra: {
        patientId: 'pat_7',
        patientName: PERSONAL.name,
        checkIn: { weight: PERSONAL.weight },
      },
      contexts: { paciente: { id: 'pat_7', email: PERSONAL.email } },
      tags: { professionalPhone: PERSONAL.phone, route: 'POST /v1/check-ins' },
    });

    const event = await flushed();

    expect(event.extra).toEqual({ patientId: 'pat_7', patientName: REDACTED, checkIn: REDACTED });
    expect(event.tags).toEqual({ professionalPhone: REDACTED, route: 'POST /v1/check-ins' });

    // `toMatchObject`, because the SDK adds contexts of its own (`runtime`,
    // `trace`). They go through the same mask, which costs the word "node" in
    // `runtime.name` — the side a list matched by field name errs on, and a
    // cheap price for not having to foresee every context.
    expect(event.contexts).toMatchObject({ paciente: { id: 'pat_7', email: REDACTED } });
  });

  it('keeps the trail of the breadcrumbs and throws away their content', async () => {
    captureEvent({
      breadcrumbs: [
        { category: 'console', message: `check-in de ${PERSONAL.name}: ${PERSONAL.note}` },
        {
          category: 'http',
          message: 'POST /v1/check-ins',
          data: {
            method: 'POST',
            status_code: 500,
            url: 'https://api.fit-app.example/v1/patients?busca=Ana',
            body: PERSONAL.note,
          },
        },
      ],
    });

    const event = await flushed();

    expect(event.breadcrumbs).toEqual([
      {
        category: 'http',
        data: {
          method: 'POST',
          status_code: 500,
          url: 'https://api.fit-app.example/v1/patients',
        },
      },
    ]);
  });

  it('lets none of it reach the wire, by any route', async () => {
    // The same event as the tests above, all at once, read as text: an
    // assertion that does not depend on knowing which field the SDK chose to
    // put something in.
    captureEvent({
      message: `falha ao salvar o check-in de ${PERSONAL.name}`,
      user: { id: USER_ID, email: PERSONAL.email, username: PERSONAL.name },
      request: {
        method: 'POST',
        url: 'https://api.fit-app.example/v1/check-ins?busca=Ana%20Souza',
        data: { notes: PERSONAL.note, weight: PERSONAL.weight },
        headers: { authorization: `Bearer ${PERSONAL.token}` },
      },
      extra: { patient: { name: PERSONAL.name, phone: PERSONAL.phone } },
      breadcrumbs: [{ category: 'console', message: PERSONAL.note }],
    });

    const text = await flushedText();

    for (const value of Object.values(PERSONAL)) {
      expect(text).not.toContain(String(value));
    }

    // And the one thing that does go out: who it happened to, as an id.
    expect(text).toContain(USER_ID);
  });
});

describe('sentryOptions', () => {
  /**
   * The other half of the wall: what the SDK is told never to pick up. The
   * filter above cannot be the only guard, because it only ever sees the
   * fields it knows the names of.
   */
  it('tells the SDK to collect no body, no cookie, no header and no query', () => {
    expect(sentryOptions(CONFIG).dataCollection).toMatchObject({
      userInfo: false,
      httpBodies: [],
      cookies: false,
      httpHeaders: false,
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    });
  });

  it('carries the environment and the release, which make an event actionable', () => {
    expect(sentryOptions(CONFIG)).toMatchObject({
      dsn: CONFIG.dsn,
      environment: 'test',
      release: 'api@test',
    });
  });
});
