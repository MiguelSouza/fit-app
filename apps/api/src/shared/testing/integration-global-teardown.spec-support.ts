import { stopIntegrationPostgres } from './integration-postgres.spec-support';

/**
 * The `globalTeardown` of the integration profile: the container goes away,
 * and the database with it.
 *
 * It runs in the same process as the setup, so it stops the container the
 * setup started. A run killed before this point leaves it to the
 * Testcontainers reaper.
 */
export default async function globalTeardown(): Promise<void> {
  await stopIntegrationPostgres();
}
