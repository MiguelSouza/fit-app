import { Logger } from '@nestjs/common';
import { type DestinationStream as PinoDestination } from 'pino';

import { createLogger } from './logger';
import { PinoLoggerService } from './pino-logger.service';
import { REDACTED } from './sensitive-data';
import { type ApiEnv } from '../config/env';

/**
 * The adapter that makes NestJS write through pino. It matters because the code
 * already written with `new Logger('Something')` — the exception filter, the
 * connection pool — goes through here, and must come out with the same
 * guarantees: structured fields and the sensitive ones masked.
 */
const env: ApiEnv = {
  nodeEnv: 'test',
  port: 0,
  databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
  corsAllowedOrigins: [],
  logLevel: 'trace',
};

function capturing(): { service: PinoLoggerService; lines: () => Record<string, unknown>[] } {
  const written: string[] = [];
  const destination: PinoDestination = {
    write(line: string): void {
      written.push(line);
    },
  };

  return {
    service: new PinoLoggerService(createLogger(env, destination)),
    lines: () => written.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('PinoLoggerService', () => {
  it('puts the NestJS context in a field of its own', () => {
    const { service, lines } = capturing();

    service.log('api listening on port 3333 under /v1', 'Bootstrap');

    expect(lines()[0]).toMatchObject({
      level: 'info',
      context: 'Bootstrap',
      msg: 'api listening on port 3333 under /v1',
    });
  });

  it('separates the stack from the message of an error', () => {
    const { service, lines } = capturing();

    service.error('unhandled TypeError', '    at somewhere (file.ts:1:1)', 'ExceptionFilter');

    expect(lines()[0]).toMatchObject({
      level: 'error',
      context: 'ExceptionFilter',
      msg: 'unhandled TypeError',
      stack: '    at somewhere (file.ts:1:1)',
    });
  });

  it('maps each NestJS level onto a pino level', () => {
    const { service, lines } = capturing();

    service.warn('w');
    service.debug('d');
    service.verbose('v');
    service.fatal('f');

    expect(lines().map((line) => line.level)).toEqual(['warn', 'debug', 'trace', 'fatal']);
  });

  it('masks the sensitive fields of an object logged through NestJS', () => {
    const { service, lines } = capturing();

    service.log({ patientId: 'pat_1', name: 'Ana Souza' }, 'SomeUseCase');

    expect(lines()[0]).toMatchObject({
      context: 'SomeUseCase',
      message: { patientId: 'pat_1', name: REDACTED },
    });
  });

  it('is what `new Logger()` writes to once NestJS is told about it', () => {
    const { service, lines } = capturing();

    Logger.overrideLogger(service);
    try {
      new Logger('DatabasePool').error('idle client failed (code=57P01)');
    } finally {
      Logger.overrideLogger(false);
    }

    expect(lines()[0]).toMatchObject({
      level: 'error',
      context: 'DatabasePool',
      msg: 'idle client failed (code=57P01)',
    });
  });
});
