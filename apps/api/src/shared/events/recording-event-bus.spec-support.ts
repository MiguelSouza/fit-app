import {
  type DomainEventName,
  type DomainEventPayload,
  type DomainEventPayloads,
} from './domain-event';
import { type DomainEventHandler, type EventBusPort } from './event-bus.port';

/** One published event, kept as the name and the payload it travelled with. */
export type PublishedEvent = {
  [Name in DomainEventName]: { readonly name: Name; readonly payload: DomainEventPayloads[Name] };
}[DomainEventName];

/**
 * The bus as a list, for the tests of whoever publishes: it records what was
 * announced and dispatches to whoever subscribed, in this process and with no
 * `EventEmitter2` under it.
 *
 * It lives in `shared/` and not in a module because publishing is not any one
 * module's business (CLAUDE.md rule 3). What it does **not** reproduce is the
 * one behaviour of `InMemoryEventBus` that matters to a publisher — a handler
 * that throws is a log line and not an exception climbing back — because that
 * is the real adapter's own job and `in-memory-event-bus.spec.ts` covers it.
 * A handler registered here is expected to work; a test that wants a failing
 * one wants the real bus.
 *
 * Not a `*.spec.ts` file, so jest does not read it as a suite, and excluded
 * from `tsconfig.build.json`, so it never reaches `dist/`.
 */
export class RecordingEventBus implements EventBusPort {
  /** What was published, in order. */
  readonly published: PublishedEvent[] = [];

  private readonly handlers = new Map<DomainEventName, DomainEventHandler<DomainEventName>[]>();

  async publish<Name extends DomainEventName>(
    name: Name,
    payload: DomainEventPayload<Name>,
  ): Promise<void> {
    this.published.push({ name, payload } as PublishedEvent);

    for (const handler of this.handlers.get(name) ?? []) {
      await handler(payload);
    }
  }

  subscribe<Name extends DomainEventName>(name: Name, handler: DomainEventHandler<Name>): void {
    const registered = this.handlers.get(name) ?? [];

    registered.push(handler as DomainEventHandler<DomainEventName>);
    this.handlers.set(name, registered);
  }

  /** The payloads of one event, for an assertion that is about one fact. */
  payloadsOf<Name extends DomainEventName>(name: Name): readonly DomainEventPayloads[Name][] {
    return this.published
      .filter((event) => event.name === name)
      .map((event) => event.payload as DomainEventPayloads[Name]);
  }
}
