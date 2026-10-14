import { resolve } from 'node:path';

import { startIntegrationPostgres } from './integration-postgres.spec-support';

/**
 * The slice of the jest project config this reads. Typed here, structurally,
 * rather than imported from `@jest/types`: that package is a transitive
 * dependency of jest and not one this app declares.
 */
interface ProjectConfig {
  /** `apps/api/src`, absolute — see `rootDir` in the jest configs. */
  readonly rootDir: string;
}

/**
 * The `globalSetup` of the integration profile: one Postgres container for the
 * whole run, migrated before the first test sees it.
 *
 * It is a `.spec-support.ts` file, which is what keeps it out of the test
 * discovery of both profiles and out of `tsconfig.build.json` — a harness that
 * starts containers has no business in the image.
 */
export default async function globalSetup(
  _globalConfig: unknown,
  projectConfig: ProjectConfig,
): Promise<void> {
  await startIntegrationPostgres(resolve(projectConfig.rootDir, '..'));
}
