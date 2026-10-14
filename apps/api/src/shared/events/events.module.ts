import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { LoggingModule } from '../logging/logging.module';
import { EVENT_BUS } from './event-bus.port';
import { InMemoryEventBus } from './in-memory-event-bus';

/**
 * Where the event bus is chosen. A module that publishes or subscribes imports
 * this one and asks for `EVENT_BUS`; it never names the implementation.
 *
 * `wildcard: false` on purpose: with wildcards on, `EventEmitter2` reads the
 * dots of `nutrition.plan.activated` as a path and a listener on
 * `nutrition.*` would receive events it never asked for. Our names are flat
 * strings that happen to contain dots (CLAUDE.md rule 3).
 */
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: false }), LoggingModule],
  providers: [{ provide: EVENT_BUS, useClass: InMemoryEventBus }],
  exports: [EVENT_BUS],
})
export class EventsModule {}
