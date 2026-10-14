/**
 * The catalogue of the background jobs, in one file, the same way
 * `shared/events/domain-event.ts` is the catalogue of the events.
 *
 * A job is work that must not happen inside a request: it is slow, it talks to
 * somebody else's server, it runs on a clock, or it has to survive a deploy
 * and be tried again. Everything else is a plain method call.
 *
 * **A payload carries ids and codes, never health or personal data.** It is
 * written to a table in Postgres and read back by a worker minutes or hours
 * later, so what goes in there is stored data (CLAUDE.md, "Saúde e LGPD").
 * The worker loads what it needs from the module that owns it.
 */
export const JOB_NAMES = ['ping'] as const;

/** Every job the queue knows. Anything else does not compile. */
export type JobName = (typeof JOB_NAMES)[number];

/**
 * What each job is given when it runs.
 *
 * `extends Record<JobName, object>` keeps the list above and the payloads here
 * in step: a name without a payload stays typed as `object`, and a payload for
 * a name that is not listed is an error.
 */
export interface JobPayloads extends Record<JobName, object> {
  /**
   * The example job of card F-10: it takes nothing and only writes a line, so
   * the queue can be seen working end to end before a real job depends on it.
   */
  ping: Record<string, never>;
}

/** The payload of one job, for whoever enqueues it or handles it. */
export type JobPayload<Name extends JobName> = JobPayloads[Name];
