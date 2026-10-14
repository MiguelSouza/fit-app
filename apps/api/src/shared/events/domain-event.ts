/**
 * The catalogue of the internal events, in one file (CLAUDE.md rule 3).
 *
 * A module announces a fact that already happened and goes on with its life;
 * whoever cares reacts. That is the only way a side effect crosses a module
 * boundary without one module reaching into another's code, and this file is
 * where the two sides agree on the name and on the payload.
 *
 * The name is always `<module>.<entity>.<fact in the past>`, lower case, three
 * parts — `event-catalogue.spec.ts` fails the build when one is not.
 *
 * **A payload carries ids and codes, never health or personal data.** It is
 * read by a handler that may log it, enqueue it or send it to a provider, and
 * a name or a check-in value in there would leak through all three
 * (CLAUDE.md, "Saúde e LGPD"). A handler that needs the data behind an id asks
 * the module that owns it — with the consent check that comes with it.
 */
export const DOMAIN_EVENT_NAMES = [
  'nutrition.plan.activated',
  'health.sleep.received',
  'insights.alert.created',
] as const;

/** Every name the bus accepts. Anything else does not compile. */
export type DomainEventName = (typeof DOMAIN_EVENT_NAMES)[number];

/**
 * What travels with each event.
 *
 * `extends Record<DomainEventName, object>` is what keeps the two halves in
 * step: adding a name to the list above without describing its payload here
 * leaves it typed as `object`, and describing a payload for a name that is not
 * in the list is an error.
 *
 * Instants are ISO 8601 in UTC, as everything else in this codebase stores
 * time; a date that means a day in the patient's life (the night a sleep
 * belongs to) is a plain `YYYY-MM-DD`, because a timestamp would move it
 * across a time zone.
 */
export interface DomainEventPayloads extends Record<DomainEventName, object> {
  /** A nutritionist put a plan in force. The previous one, if any, stopped. */
  'nutrition.plan.activated': {
    readonly planId: string;
    readonly patientId: string;
    readonly activatedAt: string;
  };

  /** A night of sleep arrived from the aggregator, named by the day it began. */
  'health.sleep.received': {
    readonly patientId: string;
    readonly nightOf: string;
  };

  /** A rule fired. The code says which one; the text of the alert stays in `insights`. */
  'insights.alert.created': {
    readonly alertId: string;
    readonly patientId: string;
    readonly ruleCode: string;
  };
}

/** The payload of one event, for whoever publishes it or handles it. */
export type DomainEventPayload<Name extends DomainEventName> = DomainEventPayloads[Name];
