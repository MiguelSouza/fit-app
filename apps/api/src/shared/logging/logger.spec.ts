import { type DestinationStream } from 'pino';

import { createLogger, ERROR_WITHOUT_MESSAGE } from './logger';
import { runWithCorrelationId } from './correlation-id';
import { REDACTED } from './sensitive-data';
import { type ApiEnv, type LogLevel } from '../config/env';

/**
 * The logger as it is actually built — the real pino instance, with the
 * options of `createLogger` — writing to a stream the test reads back.
 *
 * This is where the card's second acceptance criterion is proved: an object
 * with a name and an e-mail comes out of the logger with those fields masked.
 * The lines are parsed back from JSON, so what is asserted is the bytes that
 * would have reached CloudWatch, not an intention.
 */
interface Capture {
  readonly logger: ReturnType<typeof createLogger>;
  readonly lines: () => Record<string, unknown>[];
  /** The first line written, as an object. Fails the test if nothing was written. */
  readonly firstLine: () => Record<string, unknown>;
}

function envWith(logLevel: LogLevel): ApiEnv {
  return {
    nodeEnv: 'test',
    port: 0,
    databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
    corsAllowedOrigins: [],
    logLevel,
  };
}

function capturing(logLevel: LogLevel = 'debug'): Capture {
  const written: string[] = [];
  const lines = (): Record<string, unknown>[] =>
    written.map((line) => JSON.parse(line) as Record<string, unknown>);
  const destination: DestinationStream = {
    write(line: string): void {
      written.push(line);
    },
  };

  return {
    logger: createLogger(envWith(logLevel), destination),
    lines,
    firstLine: () => {
      const [first] = lines();
      if (first === undefined) throw new Error('expected a log line to have been written');

      return first;
    },
  };
}

describe('createLogger', () => {
  it('masks the name and the e-mail of a patient logged by accident', () => {
    const { logger, firstLine } = capturing();

    logger.info(
      {
        patientId: 'pat_1',
        patient: {
          name: 'Ana Souza',
          email: 'ana.souza@example.com',
          phone: '+5511999998888',
          timezone: 'America/Sao_Paulo',
        },
      },
      'patient record opened',
    );

    const line = firstLine();

    expect(line).toMatchObject({
      msg: 'patient record opened',
      patientId: 'pat_1',
      patient: {
        name: REDACTED,
        email: REDACTED,
        phone: REDACTED,
        timezone: 'America/Sao_Paulo',
      },
    });

    // The bytes that would have been written, with nothing personal in them.
    const raw = JSON.stringify(line);
    expect(raw).not.toContain('Ana');
    expect(raw).not.toContain('ana.souza@example.com');
    expect(raw).not.toContain('5511999998888');
  });

  it('masks a check-in, notes and a token at any depth', () => {
    const { logger, firstLine } = capturing();

    logger.warn(
      {
        alertId: 'alr_7',
        patient: { checkIn: { weight: 71.4, mood: 2, notes: 'dormi 4 horas' } },
        integration: { accessToken: 'eyJhbGciOiJIUzI1NiJ9.payload.signature' },
      },
      'alert raised',
    );

    const raw = JSON.stringify(firstLine());

    expect(raw).not.toContain('71.4');
    expect(raw).not.toContain('dormi 4 horas');
    expect(raw).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(raw).toContain('alr_7');
  });

  it('stamps the correlation id of the request in flight on every line', () => {
    const { logger, lines } = capturing();

    runWithCorrelationId('trace-abc-123', () => {
      logger.info('inside the request');
    });
    logger.info('outside the request');

    const [inside, outside] = lines();

    expect(inside).toMatchObject({ correlationId: 'trace-abc-123' });
    expect(outside).not.toHaveProperty('correlationId');
  });

  it('logs an error without its message, which can quote a column value', () => {
    const { logger, firstLine } = capturing();
    const driverError = Object.assign(
      new Error('duplicate key value violates unique constraint (email)=(ana@example.com)'),
      { code: '23505' },
    );

    logger.error({ err: driverError }, 'query failed');

    const line = firstLine();

    expect(line).toMatchObject({ msg: 'query failed', err: { type: 'Error', code: '23505' } });
    expect(JSON.stringify(line)).not.toContain('ana@example.com');
    expect(String((line.err as { stack?: string }).stack)).toContain('logger.spec.ts');
  });

  it('does not let the error stand in for a message the call did not give', () => {
    // Pino's own behaviour is `msg = err.message` when there is no message,
    // which would undo the serializer above. Both ways of logging an error
    // without a sentence go through the check.
    const { logger, lines } = capturing();
    const driverError = new Error(
      'duplicate key value violates unique constraint (email)=(ana@example.com)',
    );

    logger.error({ err: driverError });
    logger.error(driverError);

    const written = lines();

    expect(written).toHaveLength(2);
    for (const line of written) {
      expect(line.msg).toBe(ERROR_WITHOUT_MESSAGE);
      expect(line.err).toMatchObject({ type: 'Error' });
      expect(JSON.stringify(line)).not.toContain('ana@example.com');
    }
  });

  it('writes the level as a label and the time in utc iso', () => {
    const { logger, firstLine } = capturing();

    logger.debug('something happened');

    const line = firstLine();

    expect(line.level).toBe('debug');
    expect(String(line.time)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('writes nothing at all when the level is silent, which is the default under test', () => {
    const { logger, lines } = capturing('silent');

    logger.error('would be noise in a test run');

    expect(lines()).toEqual([]);
  });
});
