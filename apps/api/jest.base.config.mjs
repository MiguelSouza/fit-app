/**
 * What the two test profiles of the API share.
 *
 * It is not a config jest can run on its own: it names no test file on
 * purpose. Which files a run reads is the only difference between the
 * profiles, and it is stated in each of them —
 * [`jest.unit.config.mjs`](./jest.unit.config.mjs) and
 * [`jest.integration.config.mjs`](./jest.integration.config.mjs).
 *
 * `ts-jest` compiles with `tsconfig.spec.json`, which keeps the decorator
 * options of the build (a test that boots a Nest module needs the same
 * metadata) and emits ES modules, which is how the tests get to load NestJS —
 * see the comment in that file. Hence `--experimental-vm-modules` in the
 * scripts: it is what lets jest run a test file as a real ES module.
 *
 * @type {import('jest').Config}
 */
const base = {
  rootDir: 'src',
  testEnvironment: 'node',
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

export default base;
