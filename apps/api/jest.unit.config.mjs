import base from './jest.base.config.mjs';

/**
 * The fast profile (`pnpm --filter api test:unit`): every test that needs
 * nothing but Node.
 *
 * It is what runs on a laptop while the code is being written and what the CI
 * runs on every push, so it must not need Docker — no container, no database,
 * no network. Those tests live next to the code they cover, in `*.spec.ts`,
 * and the domain's are mandatory (CLAUDE.md, "Testes").
 *
 * @type {import('jest').Config}
 */
const config = {
  ...base,

  // A regex, not a `testMatch` glob: `rootDir` is an absolute path, and on
  // Windows its backslashes are read as escapes inside a glob.
  //
  // `\.spec\.ts$` does not match `*.integration-spec.ts` — the dot before
  // `spec` is literal — which is what keeps a test that wants a database out
  // of this profile.
  testRegex: String.raw`\.spec\.ts$`,
};

export default config;
