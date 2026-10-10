import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';

import { LOGGER, type AppLogger } from './logger';
import { CORRELATION_ID_HEADER, readCorrelationId, runWithCorrelationId } from './correlation-id';

/**
 * Gives every request a correlation id and writes one line when it is over.
 *
 * The id goes back in the response header too, so the panel and the app can
 * show it when something fails: it is the one thing a user can read out loud
 * that says nothing about them.
 *
 * What the line carries is deliberately short. No query string — a search box
 * puts whatever was typed in there, and that is usually a patient's name. No
 * ip and no user agent either: both are personal data under the LGPD and
 * neither helps debugging here.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(@Inject(LOGGER) private readonly logger: AppLogger) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const correlationId = readCorrelationId(request.headers[CORRELATION_ID_HEADER]);
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    const startedAt = process.hrtime.bigint();

    runWithCorrelationId(correlationId, () => {
      // Registered inside the correlation id's scope, so the line written when
      // the response ends still carries it. `finish` and not the end of the
      // handler: it fires for a 404 the router answered on its own too.
      response.on('finish', () => {
        this.logger.info(
          {
            method: request.method,
            path: pathWithoutQuery(request.originalUrl),
            statusCode: response.statusCode,
            durationMs: elapsedMs(startedAt),
          },
          'request handled',
        );
      });

      next();
    });
  }
}

function pathWithoutQuery(url: string): string {
  const [path] = url.split('?');

  return path ?? url;
}

/** Tenths of a millisecond is as precise as a request duration needs to be. */
function elapsedMs(startedAt: bigint): number {
  const elapsed = Number(process.hrtime.bigint() - startedAt) / 1e6;

  return Math.round(elapsed * 10) / 10;
}
