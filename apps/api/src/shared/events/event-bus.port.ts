import { type DomainEventName, type DomainEventPayload } from './domain-event';

/**
 * What a subscriber hands to the bus. It may be synchronous; the bus waits for
 * it either way.
 */
export type DomainEventHandler<Name extends DomainEventName> = (
  payload: DomainEventPayload<Name>,
) => void | Promise<void>;

/**
 * Port (CLAUDE.md rule 5): the publisher knows the fact it is announcing, not
 * who listens nor how the message gets there.
 *
 * Today the only implementation is `InMemoryEventBus`, in this same process
 * (ADR 0009). The day an event has to leave the process, a second adapter
 * implements this interface and no publisher changes.
 */
export interface EventBusPort {
  /**
   * Announces a fact and waits for every handler registered for it.
   *
   * Waiting is deliberate: it keeps the order of what happens readable, and a
   * test asserts the reaction without polling. What it does **not** do is let
   * a handler break the publisher — a handler that throws is logged and the
   * publish still resolves, because an alert that failed to be recalculated
   * must not undo the plan that was activated.
   *
   * It follows that a handler stays short. Anything slow or retryable is a job
   * (`JobQueuePort`), not work done inside the publisher's request.
   */
  publish<Name extends DomainEventName>(
    name: Name,
    payload: DomainEventPayload<Name>,
  ): Promise<void>;

  /**
   * Registers a reaction. Called once, while the module starts, never per
   * request.
   */
  subscribe<Name extends DomainEventName>(name: Name, handler: DomainEventHandler<Name>): void;
}

/** Injection token for the bus. */
export const EVENT_BUS = Symbol('fit-app.api.event-bus');
