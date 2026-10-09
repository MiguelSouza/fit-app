import { type ComponentHealth } from '../../domain/system-health';

/**
 * Port (CLAUDE.md rule 5): the use case wants to know whether the database
 * answers, not which driver asks it. `infrastructure/` implements it with
 * Postgres; a test implements it with a value.
 */
export interface DatabaseStatusPort {
  /** Answers `down` instead of throwing: an outage is a result, not a crash. */
  check(): Promise<ComponentHealth>;
}

export const DATABASE_STATUS_PORT = Symbol('fit-app.api.database-status-port');
