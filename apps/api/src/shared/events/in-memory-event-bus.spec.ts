import { EventEmitter2 } from '@nestjs/event-emitter';
import { type DestinationStream } from 'pino';

import { createLogger } from '../logging/logger';
import { type ApiEnv } from '../config/env';
import { HANDLER_FAILED, InMemoryEventBus } from './in-memory-event-bus';

const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  supabaseJwtSecret: 'unused-in-this-test-but-long-enough-0001',
  corsAllowedOrigins: [],
  logLevel: 'debug',
};

interface Harness {
  readonly bus: InMemoryEventBus;
  readonly lines: () => Record<string, unknown>[];
}

/** The real bus over the real emitter, with the log written to an array. */
function harness(): Harness {
  const written: string[] = [];
  const destination: DestinationStream = {
    write(line: string): void {
      written.push(line);
    },
  };

  return {
    bus: new InMemoryEventBus(
      new EventEmitter2({ wildcard: false }),
      createLogger(env, destination),
    ),
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const PLAN = { planId: 'plan-1', patientId: 'patient-1', activatedAt: '2026-10-14T12:00:00.000Z' };

describe('InMemoryEventBus', () => {
  it('delivers the payload to whoever subscribed to that event', async () => {
    const { bus } = harness();
    const received: unknown[] = [];

    bus.subscribe('nutrition.plan.activated', (payload) => {
      received.push(payload);
    });

    await bus.publish('nutrition.plan.activated', PLAN);

    expect(received).toEqual([PLAN]);
  });

  it('waits for an async handler before the publish resolves', async () => {
    const { bus } = harness();
    let finished = false;

    bus.subscribe('nutrition.plan.activated', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = true;
    });

    await bus.publish('nutrition.plan.activated', PLAN);

    expect(finished).toBe(true);
  });

  it('calls every handler of the event, and no handler of another one', async () => {
    const { bus } = harness();
    const calls: string[] = [];

    bus.subscribe('nutrition.plan.activated', () => void calls.push('first'));
    bus.subscribe('nutrition.plan.activated', () => void calls.push('second'));
    bus.subscribe('insights.alert.created', () => void calls.push('other event'));

    await bus.publish('nutrition.plan.activated', PLAN);

    expect(calls).toEqual(['first', 'second']);
  });

  it('keeps a failing handler from breaking the publisher, and logs it', async () => {
    const { bus, lines } = harness();
    const calls: string[] = [];

    bus.subscribe('nutrition.plan.activated', () => {
      throw new Error('the alert rules blew up');
    });
    bus.subscribe('nutrition.plan.activated', () => void calls.push('still called'));

    await expect(bus.publish('nutrition.plan.activated', PLAN)).resolves.toBeUndefined();

    expect(calls).toEqual(['still called']);

    const failure = lines().find((line) => line['msg'] === HANDLER_FAILED);

    expect(failure).toMatchObject({ event: 'nutrition.plan.activated', level: 'error' });
  });

  it('never writes the payload of an event to the log', async () => {
    const { bus, lines } = harness();

    bus.subscribe('nutrition.plan.activated', () => {
      throw new Error('boom');
    });

    await bus.publish('nutrition.plan.activated', PLAN);

    // Ids and all: what is on the bus is nobody's business in a log stream.
    expect(JSON.stringify(lines())).not.toContain('patient-1');
  });
});
