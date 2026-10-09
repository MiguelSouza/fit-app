/**
 * Unit and integration tests of the API. The example tests live next to the
 * code they cover (`*.spec.ts`), one per layer, as CLAUDE.md asks under
 * "Testes".
 *
 * `ts-jest` compiles with `tsconfig.spec.json`, which keeps the decorator
 * options of the build (a test that boots a Nest module needs the same
 * metadata) and emits ES modules, which is how the tests get to load NestJS —
 * see the comment in that file. Hence `--experimental-vm-modules` in the
 * `test` script: it is what lets jest run a test file as a real ES module.
 *
 * @type {import('jest').Config}
 */
const config = {
  rootDir: 'src',
  testEnvironment: 'node',
  // A regex, not a `testMatch` glob: `rootDir` is an absolute path, and on
  // Windows its backslashes are read as escapes inside a glob.
  testRegex: String.raw`\.spec\.ts$`,
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    [String.raw`^.+\.ts$`]: [
      'ts-jest',
      { useESM: true, tsconfig: '<rootDir>/../tsconfig.spec.json' },
    ],
  },
  clearMocks: true,
};

export default config;
