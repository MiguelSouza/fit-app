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
 * in step: a name without a payload stays typed as `object`. A payload written
 * for a name that is not listed is `StrayJobPayload`, at the end of this file:
 * `extends` alone would let it through, because an interface may always declare
 * a member its base never had.
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

/**
 * A type that has to be empty. Anything else does not satisfy the constraint,
 * and the error names what was found.
 */
type Nothing<Found extends never> = Found;

/**
 * The guard for a payload written for a job the catalogue does not list — a
 * typo, or a name renamed in one of the two halves only. `never` while the two
 * agree; the stray key stops the build.
 */
export type StrayJobPayload = Nothing<Exclude<keyof JobPayloads, JobName>>;
