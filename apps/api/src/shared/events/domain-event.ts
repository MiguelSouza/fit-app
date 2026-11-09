import { type ConsentType } from '@fit-app/contracts';

/**
 * The catalogue of the internal events, in one file (CLAUDE.md rule 3).
 *
 * A module announces a fact that already happened and goes on with its life;
 * whoever cares reacts. That is the only way a side effect crosses a module
 * boundary without one module reaching into another's code, and this file is
 * where the two sides agree on the name and on the payload.
 *
 * The name is always `<module>.<entity>.<fact in the past>`, lower case, three
 * parts — `domain-event.spec.ts` fails the build when one is not.
 *
 * **A payload carries ids and codes, never health or personal data.** It is
 * read by a handler that may log it, enqueue it or send it to a provider, and
 * a name or a check-in value in there would leak through all three
 * (CLAUDE.md, "Saúde e LGPD"). A handler that needs the data behind an id asks
 * the module that owns it — with the consent check that comes with it.
 *
 * The one thing imported here is `ConsentType`, from `@fit-app/contracts`: the
 * purpose of a consent is a closed vocabulary the whole platform already
 * shares, and a subscriber comparing it against a typo should not compile.
 * Importing it from the publishing module's `domain/` would be the boundary
 * violation (rule 1); the contracts package is Zod and types, with no I/O and
 * no module in it.
 */
export const DOMAIN_EVENT_NAMES = [
  'identity.consent.revoked',
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
 * leaves it typed as `object`. The other direction is `StrayEventPayload`, at
 * the end of this file: `extends` alone would not catch a payload described for
 * a name the list does not have, because an interface may always declare a
 * member its base never had.
 *
 * Instants are ISO 8601 in UTC, as everything else in this codebase stores
 * time; a date that means a day in the patient's life (the night a sleep
 * belongs to) is a plain `YYYY-MM-DD`, because a timestamp would move it
 * across a time zone.
 */
export interface DomainEventPayloads extends Record<DomainEventName, object> {
  /**
   * A patient took one purpose back (card I-05). It is the one event of this
   * catalogue that every other module has to care about, because it is
   * permission being withdrawn: `health` stops the wearable sync when
   * `wearable_data` goes, `insights` stops producing AI summaries when
   * `ai_processing` goes, and nothing anywhere keeps a copy that outlives it
   * (CLAUDE.md, "Saúde e LGPD": "revogar consentimento corta o acesso na
   * hora").
   *
   * Revoking `health_data` publishes this once **per purpose** that was in
   * force, so a handler only ever reads the one purpose it cares about and
   * never has to know about the cascade.
   *
   * It is **not** how the access of a professional is cut off: that is read
   * from the row at the instant of the request (ADR 0017), which is why no
   * subscriber has to be trusted for it. A handler that fails is a log line
   * (`InMemoryEventBus`), and a handler that must not be lost is a job.
   */
  'identity.consent.revoked': {
    /** The patient's `identity.profile.id`. An id, as every payload here. */
    readonly profileId: string;
    readonly consentType: ConsentType;
    readonly revokedAt: string;
  };

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

/**
 * A type that has to be empty. Anything else does not satisfy the constraint,
 * and the error names what was found.
 */
type Nothing<Found extends never> = Found;

/**
 * The guard for a payload written for a name the catalogue does not list — a
 * typo, or a name renamed in one of the two halves only. `never` while the two
 * agree; the stray key stops the build.
 */
export type StrayEventPayload = Nothing<Exclude<keyof DomainEventPayloads, DomainEventName>>;
