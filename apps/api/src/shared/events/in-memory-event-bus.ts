import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { LOGGER, type AppLogger } from '../logging/logger';
import { type DomainEventName, type DomainEventPayload } from './domain-event';
import { type DomainEventHandler, type EventBusPort } from './event-bus.port';

/** The line a failing handler leaves. Short enough to alert on. */
export const HANDLER_FAILED = 'event handler failed';

/**
 * The bus of a modular monolith: the publisher and the subscriber are in the
 * same process, so the message is a function call (ADR 0009).
 *
 * `EventEmitter2`, from `@nestjs/event-emitter`, does the dispatching.
 * `emitAsync` is what makes `publish` wait for the handlers, and every handler
 * is wrapped before it is registered, so a failure of one is a log line and
 * not an exception climbing back into whoever published.
 *
 * Only the name of the event is logged, never the payload: the payload is a
 * set of ids today and nothing guarantees the next one will not carry
 * something worse (CLAUDE.md, "Saúde e LGPD").
 */
@Injectable()
export class InMemoryEventBus implements EventBusPort {
  constructor(
    private readonly emitter: EventEmitter2,
    @Inject(LOGGER) private readonly logger: AppLogger,
  ) {}

  async publish<Name extends DomainEventName>(
    name: Name,
    payload: DomainEventPayload<Name>,
  ): Promise<void> {
    this.logger.debug({ event: name }, 'event published');

    // The wrapper below swallows every handler error, so this never rejects
    // for a reason that belongs to a subscriber.
    await this.emitter.emitAsync(name, payload);
  }

  subscribe<Name extends DomainEventName>(name: Name, handler: DomainEventHandler<Name>): void {
    // The listener returns the promise so `emitAsync` waits for it; without
    // that, an async handler would run after the publisher moved on.
    this.emitter.on(name, (payload: DomainEventPayload<Name>) => this.run(name, handler, payload));
  }

  private async run<Name extends DomainEventName>(
    name: Name,
    handler: DomainEventHandler<Name>,
    payload: DomainEventPayload<Name>,
  ): Promise<void> {
    try {
      await handler(payload);
    } catch (error) {
      this.logger.error({ err: error, event: name }, HANDLER_FAILED);
    }
  }
}
