import base from './jest.base.config.mjs';

/**
 * The profile with a real Postgres behind it (`pnpm --filter api
 * test:integration`): the use cases that only mean something against the
 * database they were written for (CLAUDE.md, "Testes").
 *
 * The database is a throwaway container, started once per run and dropped at
 * the end — see
 * [`shared/testing`](./src/shared/testing/integration-postgres.spec-support.ts).
 * It needs Docker, which the repository already requires for the local
 * Supabase stack.
 *
 * @type {import('jest').Config}
 */
const config = {
  ...base,

  // The suffix is what tells the two profiles apart; see the comment on the
  // unit profile's regex.
  testRegex: String.raw`\.integration-spec\.ts$`,

  globalSetup: '<rootDir>/shared/testing/integration-global-setup.spec-support.ts',
  globalTeardown: '<rootDir>/shared/testing/integration-global-teardown.spec-support.ts',

  // One database for the whole run, so two suites in parallel would write over
  // each other's rows. Until a suite can get a schema of its own, they run one
  // at a time.
  maxWorkers: 1,

  // Pulling the Postgres image on a cold machine, and starting it, is not a
  // unit test's five milliseconds. The container is started once, in
  // `globalSetup`, and this budget is per test.
  testTimeout: 60_000,
};

export default config;
